// meetvox-syscap — captures the whole system audio output via the Core Audio
// PROCESS TAP (macOS 14.4+) and writes interleaved 32-bit float stereo PCM to stdout
// for the Electron recorder to consume. Gated by the "System Audio Recording"
// permission (NSAudioCaptureUsageDescription), NOT screen recording — this is the
// approach that works on modern macOS.
//
// Replaces the previous ScreenCaptureKit implementation, which hit the screen-
// recording TCC wall ("user declined TCCs for … display capture") and captured
// nothing on macOS 14+.
//
// Usage: meetvox-syscap [--sample-rate 44100] [--channels 2]
// Output: raw little-endian Float32, interleaved L,R,L,R… on stdout, resampled to
//         the requested rate (the tap delivers the device's native rate, e.g. 48 kHz).
// Diagnostics + permission errors go to stderr.

import Foundation
import CoreAudio
import AudioToolbox
import AVFoundation

// MARK: - args + logging

func intArg(_ name: String, _ fallback: Int) -> Int {
    let args = CommandLine.arguments
    if let i = args.firstIndex(of: name), i + 1 < args.count, let v = Int(args[i + 1]) {
        return v
    }
    return fallback
}

let sampleRate = intArg("--sample-rate", 44100)
let channels = intArg("--channels", 2)

func logErr(_ msg: String) {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
}

// MARK: - globals read by the (capture-free) C IOProc and its worker

let gOut = FileHandle.standardOutput
// Hand audio off the real-time IOProc thread to a serial queue for resample + write.
let gWorkQueue = DispatchQueue(label: "app.meetvox.syscap.tap")
var gConverter: AVAudioConverter?
var gInputFormat: AVAudioFormat?
var gOutputFormat: AVAudioFormat?
var gInBytesPerFrame = 0

/// Resample one interleaved-float32 chunk from the tap's format to the requested
/// rate/channels and write it to stdout. Runs on gWorkQueue (off the audio thread).
func handleAudio(_ raw: Data) {
    guard let inputFormat = gInputFormat,
          let outputFormat = gOutputFormat,
          let converter = gConverter,
          gInBytesPerFrame > 0 else { return }

    let frames = raw.count / gInBytesPerFrame
    guard frames > 0,
          let inBuf = AVAudioPCMBuffer(pcmFormat: inputFormat, frameCapacity: AVAudioFrameCount(frames))
    else { return }
    inBuf.frameLength = AVAudioFrameCount(frames)
    raw.withUnsafeBytes { src in
        if let base = inBuf.audioBufferList.pointee.mBuffers.mData, let from = src.baseAddress {
            memcpy(base, from, frames * gInBytesPerFrame)
        }
    }

    let ratio = outputFormat.sampleRate / inputFormat.sampleRate
    let outCap = AVAudioFrameCount(Double(frames) * ratio) + 16
    guard let outBuf = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: outCap) else { return }

    var err: NSError?
    var supplied = false
    converter.convert(to: outBuf, error: &err) { _, status in
        if supplied {
            status.pointee = .noDataNow
            return nil
        }
        supplied = true
        status.pointee = .haveData
        return inBuf
    }
    if let err = err {
        logErr("syscap: resample error: \(err.localizedDescription)")
        return
    }

    let outBytes = Int(outBuf.frameLength) * Int(outputFormat.streamDescription.pointee.mBytesPerFrame)
    if outBytes > 0, let base = outBuf.audioBufferList.pointee.mBuffers.mData {
        gOut.write(Data(bytes: base, count: outBytes))
    }
}

// MARK: - Core Audio helpers

/// Current default output device UID — used as the aggregate's main sub-device.
func defaultOutputUID() -> CFString? {
    var dev = AudioObjectID(0)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    var addr = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultOutputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    if AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &dev) != noErr {
        return nil
    }
    var uid: Unmanaged<CFString>?
    var usize = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    var uaddr = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyDeviceUID,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    if AudioObjectGetPropertyData(dev, &uaddr, 0, nil, &usize, &uid) != noErr { return nil }
    return uid?.takeRetainedValue()
}

/// The aggregate device's input stream format (what the IOProc actually delivers).
func aggregateInputFormat(_ aggID: AudioObjectID) -> AudioStreamBasicDescription? {
    var asbd = AudioStreamBasicDescription()
    var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
    var addr = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyStreamFormat,
        mScope: kAudioObjectPropertyScopeInput,
        mElement: 0)
    if AudioObjectGetPropertyData(aggID, &addr, 0, nil, &size, &asbd) != noErr { return nil }
    return asbd
}

// MARK: - setup

guard #available(macOS 14.2, *) else {
    logErr("syscap: error — Core Audio process tap requires macOS 14.2+")
    exit(2)
}

// 1) Create the global system-audio process tap (exclude no processes).
let tapDesc = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
tapDesc.name = "meetvox-syscap"
tapDesc.isPrivate = true
var tapID = AudioObjectID(kAudioObjectUnknown)
if AudioHardwareCreateProcessTap(tapDesc, &tapID) != noErr || tapID == kAudioObjectUnknown {
    logErr("syscap: failed to create process tap (audio-recording permission denied?)")
    exit(3)
}

// 2) Private aggregate device wrapping ONLY the tap (tap alone avoids duplicate/echo).
let subTap: [String: Any] = [
    kAudioSubTapUIDKey as String: tapDesc.uuid.uuidString,
    kAudioSubTapDriftCompensationKey as String: true,
]
var aggSettings: [String: Any] = [
    kAudioAggregateDeviceNameKey as String: "meetvox-syscap-agg",
    kAudioAggregateDeviceUIDKey as String: UUID().uuidString,
    kAudioAggregateDeviceIsPrivateKey as String: true,
    kAudioAggregateDeviceIsStackedKey as String: false,
    kAudioAggregateDeviceTapAutoStartKey as String: true,
    kAudioAggregateDeviceTapListKey as String: [subTap],
]
if let outUID = defaultOutputUID() {
    aggSettings[kAudioAggregateDeviceMainSubDeviceKey as String] = outUID
}
var aggID = AudioObjectID(0)
if AudioHardwareCreateAggregateDevice(aggSettings as CFDictionary, &aggID) != noErr || aggID == 0 {
    logErr("syscap: failed to create aggregate device")
    exit(4)
}

// 3) Build the resampler: tap input format -> requested interleaved float32 @ sampleRate.
guard let inAsbd = aggregateInputFormat(aggID) else {
    logErr("syscap: failed to read tap input format")
    exit(5)
}
var inAsbdVar = inAsbd
guard let inputFormat = AVAudioFormat(streamDescription: &inAsbdVar),
      let outputFormat = AVAudioFormat(
        commonFormat: .pcmFormatFloat32,
        sampleRate: Double(sampleRate),
        channels: AVAudioChannelCount(channels),
        interleaved: true),
      let converter = AVAudioConverter(from: inputFormat, to: outputFormat)
else {
    logErr("syscap: failed to build audio converter")
    exit(6)
}
gInputFormat = inputFormat
gOutputFormat = outputFormat
gConverter = converter
gInBytesPerFrame = Int(inputFormat.streamDescription.pointee.mBytesPerFrame)

// 4) IOProc — copies samples out of the real-time buffer and hands them to the worker.
//    C function pointer: references only globals (no captured context).
let ioProc: AudioDeviceIOProc = { (_, _, inInputData, _, _, _, _) -> OSStatus in
    let abl = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inInputData))
    guard abl.count > 0, let mData = abl[0].mData, abl[0].mDataByteSize > 0 else { return noErr }
    let copy = Data(bytes: mData, count: Int(abl[0].mDataByteSize))
    gWorkQueue.async { handleAudio(copy) }
    return noErr
}
var procID: AudioDeviceIOProcID?
if AudioDeviceCreateIOProcID(aggID, ioProc, nil, &procID) != noErr {
    logErr("syscap: failed to create IO proc")
    exit(7)
}
if AudioDeviceStart(aggID, procID) != noErr {
    logErr("syscap: failed to start aggregate device")
    exit(8)
}

logErr("syscap: capturing system audio via Core Audio tap "
    + "(\(Int(inputFormat.sampleRate)) Hz \(inputFormat.channelCount)ch -> \(sampleRate) Hz \(channels)ch)")

// Private aggregate device + tap are torn down automatically on process exit.
signal(SIGTERM) { _ in exit(0) }
signal(SIGINT) { _ in exit(0) }
RunLoop.main.run()
