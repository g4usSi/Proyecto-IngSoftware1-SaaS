import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Download, FileDown, LoaderCircle, Receipt, Sparkles } from 'lucide-react';
import { TableSkeleton } from '../../components/Skeletons.jsx';
import { useToast } from '../../components/Toaster.jsx';
import { useSession } from '../auth/session.jsx';
import { formatDateTime, formatFullDate, formatMoney } from '../storage/format.js';
import { storageErrorMessage } from '../storage/storage.api.js';
import { downloadAllReceipts, downloadReceipt, listPayments, PAYMENT_STATUS } from './subscriptions.api.js';

const PAGE_SIZE = 10;
const COLUMNS = ['Fecha', 'Concepto', 'Monto', 'Estado', 'Tarjeta', 'Recibo'];

/** Historial de pagos (GET /payments), separado del historial de subidas. */
export function PaymentsPage() {
  const { session } = useSession();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ payments: [], pagination: null, loading: true, error: null });
  const [downloading, setDownloading] = useState(null);
  const [noReceipts, setNoReceipts] = useState(false);

  const load = useCallback(async (signal) => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await listPayments({ page, limit: PAGE_SIZE, token: session.token, signal });
      if (!signal?.aborted) setState({ ...data, loading: false, error: null });
    } catch (error) {
      if (!signal?.aborted) setState((current) => ({ ...current, loading: false, error: storageErrorMessage(error) }));
    }
  }, [page, session.token]);
  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort(); }, [load]);

  async function download(target) {
    setDownloading(target === 'all' ? 'all' : target.id);
    try {
      const name = target === 'all' ? await downloadAllReceipts({ token: session.token }) : await downloadReceipt(target, { token: session.token });
      toast({ type: 'success', title: 'Recibo descargado', message: name });
    } catch (error) {
      if (error.code === 'NO_RECEIPTS') setNoReceipts(true);
      toast({ type: 'error', title: 'No se pudo descargar el recibo', message: storageErrorMessage(error) });
    } finally {
      setDownloading(null);
    }
  }

  const { payments, pagination, loading, error } = state;
  const hasApproved = payments.some((payment) => payment.status === 'approved');

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="kicker">Tu plan</span>
          <h1>Historial de pagos</h1>
          <p>Tus pagos simulados con su estado y recibo. Solo los pagos aprobados tienen recibo.</p>
        </div>
        <div className="page-actions">
          <Link className="btn btn-secondary" to="/app/plans"><Sparkles aria-hidden="true" />Ver planes</Link>
          <button type="button" className="btn btn-secondary" onClick={() => download('all')}
            disabled={Boolean(downloading) || noReceipts || !pagination || pagination.total === 0} title={noReceipts ? 'Todavía no tienes pagos aprobados' : undefined}>
            {downloading === 'all' ? <LoaderCircle className="spin" aria-hidden="true" /> : <FileDown aria-hidden="true" />}{downloading === 'all' ? 'Preparando recibos…' : 'Descargar todos los recibos'}
          </button>
        </div>
      </header>

      {error && <div className="gallery-error" role="alert"><p>{error}</p><button type="button" className="btn btn-secondary" onClick={() => load()}>Volver a intentar</button></div>}

      {!error && loading && !pagination && <TableSkeleton columns={COLUMNS} label="Cargando tu historial de pagos…" />}

      {!error && pagination?.total === 0 && (
        <div className="panel panel-empty">
          <Receipt aria-hidden="true" className="panel-empty-icon" />
          <h2>Todavía no tienes pagos</h2>
          <p>Cuando contrates o renueves un plan, el pago aparecerá aquí con su recibo.</p>
          <Link className="btn btn-primary" to="/app/plans">Ver planes</Link>
        </div>
      )}

      {!error && payments.length > 0 && (
        <section className="panel payments-panel" aria-labelledby="payments-title" aria-busy={loading}>
          <h2 id="payments-title" className="sr-only">Pagos</h2>
          <div className="compare-scroll">
            <table className={`data-table${loading ? ' is-refreshing' : ''}`}>
              <thead><tr><th scope="col">Fecha</th><th scope="col">Concepto</th><th scope="col">Monto</th><th scope="col">Estado</th><th scope="col">Tarjeta</th><th scope="col"><span className="sr-only">Recibo</span></th></tr></thead>
              <tbody>
                {payments.map((payment) => {
                  const status = PAYMENT_STATUS[payment.status] ?? { label: payment.status, tone: 'muted' };
                  return (
                    <tr key={payment.id}>
                      <td data-label="Fecha" title={formatFullDate(payment.createdAt)}>{formatDateTime(payment.createdAt)}</td>
                      <td data-label="Concepto"><span className="payment-concept">Plan {payment.planName}<small className="muted" title={payment.reference}>Ref. {String(payment.reference ?? '').slice(0, 8)}</small></span></td>
                      <td data-label="Monto" className="num">{formatMoney(payment.amount, payment.currency)}</td>
                      <td data-label="Estado"><span className={`status-pill is-${status.tone}`}>{status.label}</span></td>
                      <td data-label="Tarjeta">•••• {payment.cardLast4}</td>
                      <td className="cell-action">
                        <button type="button" className="btn btn-secondary btn-small" onClick={() => download(payment)}
                          disabled={payment.status !== 'approved' || Boolean(downloading)} title={payment.status !== 'approved' ? 'Solo los pagos aprobados tienen recibo' : undefined}
                          aria-label={`Descargar recibo del pago del ${formatFullDate(payment.createdAt)}`}>
                          {downloading === payment.id ? <LoaderCircle className="spin" aria-hidden="true" /> : <Download aria-hidden="true" />}Recibo
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pagination.totalPages > 1 && (
            <nav className="pager" aria-label="Páginas del historial">
              <button type="button" className="icon-button" onClick={() => setPage(page - 1)} disabled={page <= 1 || loading} aria-label="Página anterior"><ChevronLeft strokeWidth={2} /></button>
              <span>Página {pagination.page} de {pagination.totalPages} · {pagination.total} pagos</span>
              <button type="button" className="icon-button" onClick={() => setPage(page + 1)} disabled={page >= pagination.totalPages || loading} aria-label="Página siguiente"><ChevronRight strokeWidth={2} /></button>
            </nav>
          )}
          {!hasApproved && <p className="compare-note">En esta página no hay pagos aprobados, por eso no hay recibos que descargar.</p>}
        </section>
      )}
    </div>
  );
}
