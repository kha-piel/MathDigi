export function getRoleLabel(userRole?: string) {
  const normalizedRole = userRole?.trim().toLowerCase() ?? ''

  if (normalizedRole === 'admin') {
    return 'Quản trị viên'
  }

  if (normalizedRole === 'teacher') {
    return 'Giáo viên'
  }

  return 'Học sinh'
}
