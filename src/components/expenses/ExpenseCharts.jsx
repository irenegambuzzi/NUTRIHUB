import { Wallet } from 'lucide-react'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'
import { Card } from '../ui/Card'

const AXIS_COLOR = 'var(--color-text-muted)'

// Spending by main category (pie) and over the period (bars).
export function ExpenseCharts({ pieData, barData, colorForCategory }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <p className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider flex items-center gap-1.5 mb-2">
          <Wallet size={14} /> By category
        </p>
        {pieData.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)] py-8 text-center">No expenses in this period.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>
                {pieData.map((entry) => (
                  <Cell key={entry.name} fill={colorForCategory(entry.name).hex} stroke="var(--color-surface)" strokeWidth={2} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => `€${Number(value).toFixed(2)}`}
                contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, color: 'var(--color-text)' }}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: AXIS_COLOR }} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card>
        <p className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Trend</p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={barData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={{ stroke: 'var(--color-border)' }} tickLine={false} />
            <YAxis tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
            <Tooltip
              formatter={(value) => `€${Number(value).toFixed(2)}`}
              contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, color: 'var(--color-text)' }}
            />
            <Bar dataKey="amount" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  )
}
