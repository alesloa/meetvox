import { navReduce } from './router'

test('open a meeting carries its dir', () => {
  expect(navReduce({ view: 'home' }, { type: 'openMeeting', dir: '/r/meeting_x' }))
    .toEqual({ view: 'meeting', meetingDir: '/r/meeting_x' })
})
test('back from meeting → home', () => {
  expect(navReduce({ view: 'meeting', meetingDir: '/x' }, { type: 'home' })).toEqual({ view: 'home' })
})
test('navigate to settings/import/library', () => {
  expect(navReduce({ view: 'home' }, { type: 'settings' })).toEqual({ view: 'settings' })
  expect(navReduce({ view: 'home' }, { type: 'import' })).toEqual({ view: 'import' })
  expect(navReduce({ view: 'home' }, { type: 'library' })).toEqual({ view: 'library' })
})
