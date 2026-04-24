const LABELS = {
  open:                 'Open',
  ce_pending:           'CE Pending',
  customer_pending:     'Customer Pending',
  third_party_pending:  '3rd Party Pending',
  monitoring:           'Monitoring',
  resolved:             'Resolved',
  close_pending:        'Closure Requested',
  closed:               'Closed',
}

export default function StatusBadge({ status }) {
  return (
    <span className={`badge badge-${status}`}>
      {LABELS[status] ?? status}
    </span>
  )
}
