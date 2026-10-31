// Estados de carga con la forma del contenido final, para que la pantalla no salte al llegar los datos.
// `.sk-fade` aparece con un pequeño retraso: una respuesta rápida no llega a mostrar el esqueleto.
const WIDTHS = ['72%', '48%', '60%', '84%', '40%', '66%'];
const width = (index) => ({ width: WIDTHS[index % WIDTHS.length] });

export function LoadingStatus({ label = 'Cargando…' }) {
  return <span className="sr-only" role="status">{label}</span>;
}

/** Tabla con los encabezados reales y filas de relleno. */
export function TableSkeleton({ columns, rows = 5, label }) {
  return (
    <section className="panel sk-fade">
      <LoadingStatus label={label} />
      <div className="compare-scroll" aria-hidden="true">
        <table className="data-table sk-table">
          <thead><tr>{columns.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead>
          <tbody>
            {Array.from({ length: rows }, (_, row) => (
              <tr key={row}>{columns.map((column, cell) => <td key={column} data-label={column}><span className="sk-line" style={width(row + cell)} /></td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Filas con icono y dos líneas (papelera, historial, pagos recientes). */
export function RowsSkeleton({ rows = 3, label, panel = true }) {
  return (
    <div className={`${panel ? 'panel ' : ''}sk-rows sk-fade`}>
      <LoadingStatus label={label} />
      {Array.from({ length: rows }, (_, row) => (
        <div className="sk-row" key={row} aria-hidden="true">
          <span className="sk-block" />
          <span className="sk-row-lines"><span className="sk-line" style={width(row)} /><span className="sk-line short" /></span>
        </div>
      ))}
    </div>
  );
}

/** Pares etiqueta-valor (detalle de cuenta, perfil). */
export function DetailSkeleton({ rows = 4, label }) {
  return (
    <div className="sk-detail sk-fade">
      <LoadingStatus label={label} />
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} aria-hidden="true"><span className="sk-line short" /><span className="sk-line" style={width(row + 1)} /></div>
      ))}
    </div>
  );
}
