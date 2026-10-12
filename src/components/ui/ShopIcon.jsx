import { Globe, Store } from 'lucide-react'

// A globe for an online store, a shop front for a physical one.
export function ShopIcon({ online, size = 12, className }) {
  const Icon = online ? Globe : Store
  return <Icon size={size} className={className} aria-label={online ? 'Online store' : 'Physical store'} role="img" />
}

// A store's icon and name as small text, e.g. next to a category.
export function ShopTag({ shop }) {
  return (
    <span className="inline-flex items-center gap-1 align-middle" data-shop={shop.id}>
      <ShopIcon online={shop.is_online} size={10} />
      {shop.name}
    </span>
  )
}
