import { useEffect, useState } from 'react'
import { photoUrl } from '../lib/receipts'

// A viewing link for a private receipt file (null while it loads).
export function usePhotoUrl(photo) {
  const [state, setState] = useState({ path: null, url: null })
  useEffect(() => {
    if (!photo?.path) return
    let alive = true
    photoUrl(photo.path)
      .then((url) => alive && setState({ path: photo.path, url }))
      .catch(() => alive && setState({ path: photo.path, url: null }))
    return () => {
      alive = false
    }
  }, [photo?.path])
  return state.path === photo?.path ? state.url : null
}
