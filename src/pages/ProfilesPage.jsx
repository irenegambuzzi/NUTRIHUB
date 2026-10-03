import { useState } from 'react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Label, Input } from '../components/ui/Field'
import { useProfiles } from '../hooks/useProfiles'
import { AccountSettings } from '../components/auth/AccountSettings'

function ProfileCard({ profile, onSave }) {
  const [form, setForm] = useState({
    dailyCalories: profile.daily_calories,
    proteinG: profile.protein_g,
    carbsG: profile.carbs_g,
    fatG: profile.fat_g,
  })
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    const { error } = await onSave(profile.id, {
      daily_calories: Number(form.dailyCalories) || 0,
      protein_g: Number(form.proteinG) || 0,
      carbs_g: Number(form.carbsG) || 0,
      fat_g: Number(form.fatG) || 0,
    })
    setSaving(false)
    // A failed save shows a toast; the form keeps the values.
    return { error }
  }

  return (
    <Card className="space-y-4">
      <h3 className="text-base font-bold text-[var(--color-primary)]">{profile.display_name}</h3>

      <div>
        <Label>Daily calories (kcal)</Label>
        <Input
          type="number"
          value={form.dailyCalories}
          onChange={(e) => setForm({ ...form, dailyCalories: e.target.value })}
          className="font-mono font-bold text-[var(--color-accent)]"
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label>Protein (g)</Label>
          <Input type="number" value={form.proteinG} onChange={(e) => setForm({ ...form, proteinG: e.target.value })} />
        </div>
        <div>
          <Label>Carbs (g)</Label>
          <Input type="number" value={form.carbsG} onChange={(e) => setForm({ ...form, carbsG: e.target.value })} />
        </div>
        <div>
          <Label>Fat (g)</Label>
          <Input type="number" value={form.fatG} onChange={(e) => setForm({ ...form, fatG: e.target.value })} />
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving} className="w-full">
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </Card>
  )
}

export function ProfilesPage() {
  const { profiles, loading, saveProfile } = useProfiles()

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-extrabold text-[var(--color-primary)]">Profiles</h2>
      <p className="text-xs text-[var(--color-text-muted)]">
        Each of you keeps your own daily targets. They&apos;re saved and shared automatically.
      </p>

      {loading ? (
        <p className="text-xs text-[var(--color-text-muted)]">Loading…</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {profiles.map((profile) => (
            // Keyed by the saved version, so the form restarts from new values
            // (e.g. saved on the other phone).
            <ProfileCard key={`${profile.id}-${profile.updated_at}`} profile={profile} onSave={saveProfile} />
          ))}
        </div>
      )}

      <AccountSettings />
    </div>
  )
}
