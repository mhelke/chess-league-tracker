function StatusBadge({ status, count }) {
    const getStatusConfig = (status) => {
        switch (status) {
            case 'open':
                return {
                    label: 'Open',
                    className: 'badge-open',
                }
            case 'in_progress':
                return {
                    label: 'In Progress',
                    className: 'badge-in-progress',
                }
            case 'finished':
                return {
                    label: 'Finished',
                    className: 'badge-finished',
                }
            default:
                return {
                    label: status,
                    className: 'bg-gray-100 text-gray-800',
                }
        }
    }

    const config = getStatusConfig(status)

    return (
        <span className={`badge ${config.className}`}>
            {config.label}
            {count !== undefined && ` (${count})`}
        </span>
    )
}

export default StatusBadge
