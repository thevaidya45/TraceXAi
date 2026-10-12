import { useState } from 'react';
import { formatInvestigationDateTime } from '../../services/investigationService.js';

const FILTERS = [
  { value: 'ALL', label: 'All' },
  { value: 'ITEM', label: 'Item events' },
  { value: 'PERSON', label: 'Person events' },
  { value: 'ANALYSIS', label: 'Analysis events' }
];

function eventTime(event) {
  if (event.time) {
    return event.time.clockTime
      ? `${event.time.clockTime} · ${event.time.offsetLabel}`
      : event.time.offsetLabel;
  }
  if (event.completedAt) {
    return formatInvestigationDateTime(event.completedAt);
  }
  return 'No timestamp';
}

/** Chronological events generated from the stored analysis result. */
export default function InvestigationTimeline({ timeline }) {
  const [filter, setFilter] = useState('ALL');
  if (!timeline || timeline.events.length === 0) {
    return <p className="muted-text">No timeline events are available for this recording.</p>;
  }

  const events = filter === 'ALL'
    ? timeline.events
    : timeline.events.filter((event) => event.kind === filter);

  return (
    <div className="timeline-block">
      <div className="timeline-filters" role="group" aria-label="Filter timeline events">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`chip-btn${filter === option.value ? ' is-active' : ''}`}
            aria-pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {events.length === 0 ? (
        <p className="muted-text">No events of this type were recorded.</p>
      ) : (
        <ol className="timeline">
          {events.map((event) => (
            <li key={event.id} className={`timeline-item kind-${event.kind.toLowerCase()}`}>
              <div className="timeline-time">{eventTime(event)}</div>
              <div className="timeline-body">
                <p className="timeline-title">
                  {event.title}
                  <span className="timeline-kind">{event.kind}</span>
                </p>
                <p className="muted-text">{event.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      )}

      {timeline.truncated ? (
        <p className="muted-text">
          {timeline.hiddenPersonEvents} further person detection
          {timeline.hiddenPersonEvents === 1 ? '' : 's'} are recorded but not listed here.
        </p>
      ) : null}
    </div>
  );
}
