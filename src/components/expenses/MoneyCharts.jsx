import { Wallet, ChartColumn, ChartLine } from 'lucide-react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line, ReferenceLine } from 'recharts'
import { Card } from '../ui/Card'
import { setTrendStyle, useTrendStyle } from '../../lib/trendStyle'
import { cn } from '../../lib/cn'

const AXIS_COLOR = 'var(--color-text-muted)'
const TOOLTIP_STYLE = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, color: 'var(--color-text)' }
const money = (value) => `€${Number(value).toFixed(2)}`

// The category index / time bucket a click on a chart landed on.
const indexOf = (state) => {
  const i = Number(state?.activeTooltipIndex ?? state?.activeIndex)
  return Number.isInteger(i) && i >= 0 ? i : null
}

// Bars or a line, remembered on this device.
function TrendStyleToggle() {
  const style = useTrendStyle()
  const options = [
    { value: 'bars', label: 'Bars', Icon: ChartColumn },
    { value: 'line', label: 'Line', Icon: ChartLine },
  ]
  return (
    <div className="flex gap-0.5 bg-[var(--color-surface-soft)] border border-[var(--color-border)] rounded-full p-0.5" role="group" aria-label="Trend style">
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          onClick={() => setTrendStyle(value)}
          aria-pressed={style === value}
          aria-label={`${label} chart`}
          title={`${label} chart`}
          className={cn(
            'w-10 h-8 rounded-full flex items-center justify-center transition-all duration-200',
            style === value ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)]'
          )}
        >
          <Icon size={15} />
        </button>
      ))}
    </div>
  )
}

// Spending (or income) by main category (pie) and over the period (bars
// or a line). Clicking a slice, a legend entry or a column picks it as a
// filter for the list; clicking it again lets go.
//   pieData: [{ key, name, value, hex }]   barData: [{ key, label, amount }]
export function MoneyCharts({ pieData, barData, emptyText, selectedCategory, selectedBucket, onCategory, onBucket }) {
  const trendStyle = useTrendStyle()
  const bucketIndex = barData.findIndex((b) => b.key === selectedBucket)
  const selectedLabel = bucketIndex >= 0 ? barData[bucketIndex].label : null
  const onTrendClick = (state) => {
    const i = indexOf(state)
    if (i !== null && barData[i]) onBucket(barData[i].key)
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <p className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider flex items-center gap-1.5 mb-2">
          <Wallet size={14} /> By category
        </p>
        {pieData.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)] py-8 text-center">{emptyText}</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={190}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={45}
                  outerRadius={80}
                  paddingAngle={2}
                  onClick={(_, i) => pieData[i] && onCategory(pieData[i].key)}
                  style={{ cursor: 'pointer' }}
                >
                  {pieData.map((entry) => (
                    <Cell
                      key={entry.key}
                      fill={entry.hex}
                      fillOpacity={selectedCategory && selectedCategory !== entry.key ? 0.3 : 1}
                      stroke={selectedCategory === entry.key ? 'var(--color-text)' : 'var(--color-surface)'}
                      strokeWidth={2}
                    />
                  ))}
                </Pie>
                <Tooltip formatter={money} contentStyle={TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
            <ul className="flex flex-wrap justify-center gap-x-1 gap-y-1 mt-1">
              {pieData.map((entry) => (
                <li key={entry.key}>
                  <button
                    onClick={() => onCategory(entry.key)}
                    aria-pressed={selectedCategory === entry.key}
                    className={cn(
                      'min-h-10 px-3 rounded-full inline-flex items-center gap-1.5 text-[11px] border transition-all duration-200',
                      selectedCategory === entry.key ? 'border-[var(--color-text-soft)] text-[var(--color-text)]' : 'border-transparent text-[var(--color-text-muted)]',
                      selectedCategory && selectedCategory !== entry.key && 'opacity-60'
                    )}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: entry.hex }} />
                    {entry.name}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card>
        <div className="flex justify-between items-center mb-2">
          <p className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Trend</p>
          <TrendStyleToggle />
        </div>
        <ResponsiveContainer width="100%" height={220}>
          {trendStyle === 'line' ? (
            <LineChart data={barData} onClick={onTrendClick} style={{ cursor: 'pointer' }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={{ stroke: 'var(--color-border)' }} tickLine={false} />
              <YAxis tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
              <Tooltip formatter={money} contentStyle={TOOLTIP_STYLE} />
              {selectedLabel && <ReferenceLine x={selectedLabel} stroke="var(--color-text-soft)" strokeDasharray="4 3" />}
              <Line
                type="monotone"
                dataKey="amount"
                stroke="var(--color-primary)"
                strokeWidth={2.5}
                dot={{ r: 4, fill: 'var(--color-primary)', strokeWidth: 0 }}
                activeDot={{ r: 7 }}
                isAnimationActive={false}
              />
            </LineChart>
          ) : (
            <BarChart data={barData} onClick={onTrendClick} style={{ cursor: 'pointer' }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={{ stroke: 'var(--color-border)' }} tickLine={false} />
              <YAxis tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
              <Tooltip formatter={money} contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="amount" fill="var(--color-primary)" radius={[6, 6, 0, 0]}>
                {selectedBucket && barData.map((b) => <Cell key={b.key} fill="var(--color-primary)" fillOpacity={b.key === selectedBucket ? 1 : 0.3} />)}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </Card>
    </div>
  )
}
