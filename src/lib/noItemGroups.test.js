import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Round 6D stage 5: the item-group and variant mechanics are gone (K135,
// K136). No screen text, reason or style of theirs is left in the app's
// code (tests aside). Order groups (plan 9I) are something else and stay
// ("Take out of the group" there is theirs).
const root = path.resolve(import.meta.dirname, '..')
const sources = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sources(full)
    return /\.(js|jsx)$/.test(entry.name) && !/\.test\.|fixture/.test(entry.name) ? [full] : []
  })

const GONE = [
  'not-urgent',
  'Not urgent',
  '/> Add group',
  'Add a group',
  'Edit group',
  'Create group',
  'Add a variant',
  'Edit variant',
  'Group (optional)',
  'Convert and move',
  'Item groups need a one-time update',
  'Take out of the group (becomes a normal item again)',
  'is a normal item again',
  'Add to a variant of an item group',
  'Which group?',
  'Choose a group…',
  'There are no item groups yet',
  'Which variant',
  'Choose a variant…',
  'New variant…',
  'Name / brand of the new variant',
  'Add another variant',
  'You choose the variant when confirming',
  'This group has no variants yet',
  'gets the stock.`',
  'a new variant of',
  'the new variant',
  '} (group)`',
  'withGroupTotals',
  'syncGroup',
  'useShopTidy',
  'GroupShopCard',
  'GroupTile',
  'groupShop',
]

describe('no item-group or variant mechanics left in the code (round 6D stage 5)', () => {
  const files = sources(root).map((file) => ({ file: path.relative(root, file), text: fs.readFileSync(file, 'utf8') }))

  it('reads the app\'s own files', () => {
    expect(files.length).toBeGreaterThan(100)
    expect(files.some((f) => f.file === path.join('lib', 'inventory.js'))).toBe(true)
  })

  it.each(GONE)('"%s" is nowhere', (text) => {
    expect(files.filter((f) => f.text.includes(text)).map((f) => f.file)).toEqual([])
  })
})
