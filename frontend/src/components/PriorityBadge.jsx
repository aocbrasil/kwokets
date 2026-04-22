const LABELS = { p1: 'P1 Critical', p2: 'P2 High', p3: 'P3 Medium', p4: 'P4 Low' }

export default function PriorityBadge({ priority }) {
  return (
    <span className={`badge badge-${priority}`}>
      {LABELS[priority] ?? priority}
    </span>
  )
}
