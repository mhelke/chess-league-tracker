import { useEffect } from 'react'

function WhatsNewModal({ announcement, isOpen, onClose }) {
    useEffect(() => {
        if (!isOpen) return undefined

        const handleKeyDown = event => {
            if (event.key === 'Escape') onClose()
        }

        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [isOpen, onClose])

    if (!isOpen) return null

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            role="presentation"
            onMouseDown={event => {
                if (event.target === event.currentTarget) onClose()
            }}
        >
            <div
                className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-2xl"
                role="dialog"
                aria-modal="true"
                aria-labelledby="whats-new-title"
                aria-describedby="whats-new-intro"
            >
                <div className="border-b border-gray-200 px-5 py-5 sm:px-7 sm:py-6">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-chess-green">
                                What&apos;s new
                            </p>
                            <h2 id="whats-new-title" className="text-2xl font-bold text-chess-dark sm:text-3xl">
                                {announcement.title}
                            </h2>
                            <p id="whats-new-intro" className="mt-2 text-gray-600">
                                {announcement.intro}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="-mr-2 -mt-2 rounded-md p-2 text-2xl leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                            aria-label="Close what's new"
                        >
                            &times;
                        </button>
                    </div>
                </div>

                <div className="px-5 py-5 sm:px-7 sm:py-6">
                    <ol className="space-y-5">
                        {announcement.items.map((item, index) => (
                            <li key={item.title} className="flex gap-3">
                                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-green-100 text-sm font-bold text-green-800">
                                    {index + 1}
                                </span>
                                <div>
                                    <h3 className="font-semibold text-gray-900">{item.title}</h3>
                                    <p className="mt-1 text-sm leading-6 text-gray-600">{item.description}</p>
                                </div>
                            </li>
                        ))}
                    </ol>
                </div>

                <div className="flex justify-end border-t border-gray-200 bg-gray-50 px-5 py-4 sm:px-7">
                    <button type="button" onClick={onClose} className="btn btn-primary">
                        Got it
                    </button>
                </div>
            </div>
        </div>
    )
}

export default WhatsNewModal
