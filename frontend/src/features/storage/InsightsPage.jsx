import { useMemo } from 'react';
import { PiggyBank, Scale, Trophy, Weight } from 'lucide-react';
import { formatBytes, formatPercent, savingRatio } from './format.js';
import { Thumb } from './Gallery.jsx';
import { useLibrary } from './library.jsx';
import { StatCard } from './StatCard.jsx';

function formatOf(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'JPG';
  if (ext === 'png') return 'PNG';
  if (ext === 'webp') return 'WebP';
  return 'Otro';
}

/** Ahorro: cuánto pesan tus imágenes antes y después, por formato y las que más bajaron. */
export function InsightsPage() {
  const { items, stats, nextCursor } = useLibrary();

  const byFormat = useMemo(() => {
    const groups = new Map();
    items.forEach((file) => {
      const key = formatOf(file.originalName);
      const group = groups.get(key) ?? { format: key, count: 0, original: 0, webp: 0 };
      group.count += 1;
      group.original += Number(file.originalSizeBytes || 0);
      group.webp += Number(file.optimizedSizeBytes || 0);
      groups.set(key, group);
    });
    return [...groups.values()].sort((a, b) => b.original - a.original);
  }, [items]);

  const top = useMemo(() => [...items].sort((a, b) => savingRatio(b) - savingRatio(a)).slice(0, 5), [items]);
  const maxOriginal = Math.max(1, ...byFormat.map((group) => group.original));
  const saved = Math.max(0, stats.originalBytes - stats.webpBytes);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="kicker">Análisis</span>
          <h1>Tu ahorro</h1>
          <p>Cuánto pesan tus imágenes en WebP frente a los archivos originales{nextCursor ? ' (de las imágenes cargadas)' : ''}.</p>
        </div>
      </header>

      <div className="stats-grid is-three">
        <StatCard icon={PiggyBank} label="Espacio ahorrado" value={saved} format={formatBytes} hint={`${Math.round(stats.savedRatio * 100)} % menos`} ready={stats.loaded} accent index={0} />
        <StatCard icon={Weight} label="Originales" value={stats.originalBytes} format={formatBytes} hint="lo que cuenta tu plan" ready={stats.loaded} index={1} />
        <StatCard icon={Scale} label="En WebP" value={stats.webpBytes} format={formatBytes} hint="lo que se guarda y descargas" ready={stats.loaded} index={2} />
      </div>

      <div className="overview-grid">
        <section className="panel" aria-labelledby="format-title">
          <div className="panel-head"><h2 id="format-title">Por formato de origen</h2></div>
          {byFormat.length === 0 ? <p className="panel-muted">Aún no hay datos.</p> : (
            <ul className="format-bars">
              {byFormat.map((group) => (
                <li key={group.format}>
                  <div className="format-bars-head">
                    <strong>{group.format}</strong>
                    <span>{group.count} {group.count === 1 ? 'imagen' : 'imágenes'} · {formatPercent(group.original ? (group.original - group.webp) / group.original : 0)}</span>
                  </div>
                  <div className="format-track"><i className="is-original" style={{ '--w': `${(group.original / maxOriginal) * 100}%` }} /></div>
                  <div className="format-track"><i className="is-webp" style={{ '--w': `${(group.webp / maxOriginal) * 100}%` }} /></div>
                  <div className="format-values"><span>Original {formatBytes(group.original)}</span><span>WebP {formatBytes(group.webp)}</span></div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel" aria-labelledby="top-title">
          <div className="panel-head"><h2 id="top-title"><Trophy strokeWidth={2} aria-hidden="true" />Las que más bajaron</h2></div>
          {top.length === 0 ? <p className="panel-muted">Aún no hay datos.</p> : (
            <ol className="top-list">
              {top.map((file, index) => (
                <li key={file.id}>
                  <span className="top-rank">{index + 1}</span>
                  <Thumb file={file} className="is-small" />
                  <div><strong title={file.originalName}>{file.originalName}</strong><span>{formatBytes(file.originalSizeBytes)} → {formatBytes(file.optimizedSizeBytes)}</span></div>
                  <span className="saving-badge">{formatPercent(savingRatio(file))}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
      <p className="privacy-footnote">El ahorro depende de cada imagen: fotos PNG suelen bajar mucho; imágenes ya comprimidas, poco. Si subes un archivo que ya existía, no se guarda otra copia.</p>
    </div>
  );
}
