import { expect, it } from 'vitest'
import { getRoleLabel } from './role-label'

it.each([
  ['admin', 'Quản trị viên'],
  [' ADMIN ', 'Quản trị viên'],
  ['teacher', 'Giáo viên'],
  [' Teacher ', 'Giáo viên'],
  ['student', 'Học sinh'],
  [' STUDENT ', 'Học sinh'],
  ['unknown', 'Học sinh'],
  ['', 'Học sinh'],
  ['   ', 'Học sinh'],
  [undefined, 'Học sinh'],
])('labels role %s as %s', (role, label) => {
  expect(getRoleLabel(role)).toBe(label)
})
