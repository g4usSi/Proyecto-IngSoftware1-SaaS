import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CloudUpload, LoaderCircle } from 'lucide-react';
import { formatBytes, formatPercent, savingRatio } from './format.js';
import { Thumb } from './Gallery.jsx';
import { useLibrary } from './library.jsx';

const dayFormat = new Intl.DateTimeFormat('es-GT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('es-GT', { timeStyle: 'short' });

function dayLabel(date) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Hoy';
  if (date.toDateString() === yesterday.toDateString()) return 'Ayer';
  const text = dayFormat.format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Historial de subidas agrupado por día. */
export function HistoryPage() {
  const { items, loaded, loading, nextCursor, loadMore } = useLibrary();

  const days = useMemo(() => {
    const groups = new Map();
    [...items].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).forEach((file) => {
      const date = new Date(file.createdAt);
      const key = date.toDateString();
      if (!groups.has(key)) groups.set(key, { label: dayLabel(date), files: [], bytes: 0 });
      const group = groups.get(key);
      group.files.push(file);
      group.bytes += Number(file.originalSizeBytes || 0);
    });
    return [...groups.values()];
  }, [items]);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="kicker">Biblioteca</span>
          <h1>Historial</h1>
          <p>Todo lo que has subido, día por día.</p>
        </div>
      </header>

      {loaded && days.length === 0 && (
        <div className="panel panel-empty">
          <p>Tu historial está vacío.</p>
          <Link className="btn btn-secondary" to="/app/upload"><CloudUpload strokeWidth={2} aria-hidden="true" />Subir imágenes</Link>
        </div>
      )}

      {days.map((day, dayIndex) => (
        <section className="panel history-day" key={day.label} style={{ '--i': dayIndex }}>
          <div className="panel-head">
            <h2>{day.label}</h2>
            <span className="history-sum">{day.files.length} {day.files.length === 1 ? 'subida' : 'subidas'} · {formatBytes(day.bytes)}</span>
          </div>
          <ol className="timeline">
            {day.files.map((file) => (
              <li key={file.id}>
                <time dateTime={file.createdAt}>{timeFormat.format(new Date(file.createdAt))}</time>
                <span className="timeline-dot" aria-hidden="true" />
                <Thumb file={file} className="is-small" />
                <div>
                  <strong title={file.originalName}>{file.originalName}</strong>
                  <span>{formatBytes(file.originalSizeBytes)} → {formatBytes(file.optimizedSizeBytes)} · {formatPercent(savingRatio(file))}</span>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}

      {nextCursor && (
        <div className="gallery-more">
          <button type="button" className="btn btn-secondary" onClick={loadMore} disabled={loading}>
            {loading ? <><LoaderCircle className="spin" strokeWidth={2} aria-hidden="true" />Cargando…</> : 'Ver subidas anteriores'}
          </button>
        </div>
      )}
    </div>
  );
}
