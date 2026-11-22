import { useEffect, useState } from 'react'

type AuthRouteLoadingProps = {
  message: string
  delayMs?: number
}

export function AuthRouteLoading({
  message,
  delayMs = 250,
}: AuthRouteLoadingProps) {
  const [visibility, setVisibility] = useState({ delayMs, message, shouldShow: delayMs <= 0 })
  const matchesProps = visibility.delayMs === delayMs && visibility.message === message
  const shouldShow = matchesProps ? visibility.shouldShow : delayMs <= 0

  if (!matchesProps) {
    setVisibility({ delayMs, message, shouldShow: delayMs <= 0 })
  }

  useEffect(() => {
    if (delayMs <= 0) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setVisibility({ delayMs, message, shouldShow: true })
    }, delayMs)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [delayMs, message])

  if (!shouldShow) {
    return null
  }

  return (
    <div
      style={{
        borderRadius: '24px',
        padding: '24px',
        backgroundColor: '#ffffff',
        border: '1px solid #d8e3ef',
        color: '#49627f',
      }}
    >
      {message}
    </div>
  )
}
