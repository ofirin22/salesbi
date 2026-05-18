import { useState, useEffect, useRef, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Upload, CheckCircle, XCircle, FileSpreadsheet, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';

const IMPORT_API_URL    = import.meta.env.VITE_IMPORT_API_URL;
const IMPORT_API_SECRET = import.meta.env.VITE_IMPORT_API_SECRET;

const REQUIRED_COLS = [
  'Order Number', 'Customer ID', 'Customer Name', 'Order Date',
  'Sales Representative', 'SKU', 'Product Name', 'Brand',
  'Quantity', 'Line Total', 'Discount', 'Tax'
];

const StatusBadge = ({ status }) => {
  const map = {
    success:         'bg-emerald-100 text-emerald-700',
    partial_success: 'bg-yellow-100 text-yellow-700',
    failed:          'bg-red-100 text-red-700',
    processing:      'bg-blue-100 text-blue-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${map[status] || 'bg-muted text-muted-foreground'}`}>
      {status?.replace(/_/g, ' ')}
    </span>
  );
};

export default function UploadData() {
  const { user } = useOutletContext();
  const [file, setFile]               = useState(null);
  const [phase, setPhase]             = useState('idle');
  const [error, setError]             = useState(null);
  const [jobStatus, setJobStatus]     = useState(null);
  const [logs, setLogs]               = useState([]);
  const [expandedLog, setExpandedLog] = useState(null);
  const fileRef  = useRef();
  const pollRef  = useRef(null);

  const refreshLogs = useCallback(() => {
    base44.entities.ImportLog.list('-created_date', 20).then(setLogs).catch(() => {});
  }, []);

  useEffect(() => {
    if (user?.role === 'admin') refreshLogs();
  }, [user, refreshLogs]);

  useEffect(() => () => clearInterval(pollRef.current), []);

  const startPolling = useCallback((jobId) => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${IMPORT_API_URL}/status/${jobId}`, {
          headers: { 'x-import-secret': IMPORT_API_SECRET },
        });
        const data = await res.json();
        setJobStatus(data);
        if (data.status === 'done') {
          clearInterval(pollRef.current);
          setPhase('done');
          refreshLogs();
        } else if (data.status === 'failed') {
          clearInterval(pollRef.current);
          setError(data.error || 'Import failed');
          setPhase('error');
          refreshLogs();
        }
      } catch (_e) {
        // network hiccup — keep polling
      }
    }, 3000);
  }, [refreshLogs]);

  const handleUpload = async () => {
    if (!file) return;
    if (!IMPORT_API_URL || !IMPORT_API_SECRET) {
      setError('Backend not configured. Set VITE_IMPORT_API_URL and VITE_IMPORT_API_SECRET in Base44 settings.');
      setPhase('error');
      return;
    }
    setPhase('uploading');
    setError(null);
    setJobStatus(null);
    clearInterval(pollRef.current);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${IMPORT_API_URL}/import`, {
        method: 'POST',
        headers: {
          'x-import-secret': IMPORT_API_SECRET,
          'x-user-email':    user?.email || '',
        },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || 'Upload failed');
        setPhase('error');
        return;
      }
      setPhase('processing');
      setJobStatus({ ...data, phase: 'Starting...' });
      startPolling(data.jobId);
      refreshLogs();
    } catch (e) {
      setError(e.message);
      setPhase('error');
    }
  };

  if (user?.role !== 'admin') {
    return <div className="flex items-center justify-center h-64 text-muted-foreground">Access denied.</div>;
  }

  const isActive = phase === 'uploading' || phase === 'processing';
  const progressPercent = jobStatus?.chunksTotal > 0
    ? Math.round((jobStatus.currentChunk / jobStatus.chunksTotal) * 100)
    : 0;
  const backendConfigured = !!IMPORT_API_URL && !!IMPORT_API_SECRET;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Upload Data</h1>
        <p className="text-sm text-muted-foreground mt-1">Import sales data from CSV files (supports 70,000+ rows)</p>
      </div>

      {!backendConfigured && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-sm text-yellow-800">
          <strong>Backend not configured.</strong> Deploy the Railway backend from <code>railway-backend/</code> then set
          <code> VITE_IMPORT_API_URL</code> and <code>VITE_IMPORT_API_SECRET</code> in Base44 settings.
        </div>
      )}

      {/* Upload Card */}
      <div className="bg-card border border-border rounded-2xl p-6">
        <h2 className="section-title mb-4">Upload CSV File</h2>

        <div className="mb-6 p-4 bg-accent/40 rounded-xl">
          <p className="text-xs font-semibold text-accent-foreground mb-3">Required Columns</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {REQUIRED_COLS.map(col => (
              <div key={col} className="flex items-center gap-2">
                <CheckCircle className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                <span className="text-xs text-foreground">{col}</span>
              </div>
            ))}
          </div>
        </div>

        <div
          className={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer
            ${file ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/50'}
            ${isActive ? 'pointer-events-none opacity-60' : ''}`}
          onClick={() => !isActive && fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept=".csv" className="hidden"
            onChange={e => { setFile(e.target.files[0]); setPhase('idle'); setError(null); }} />
          <FileSpreadsheet className={`w-10 h-10 mx-auto mb-3 ${file ? 'text-primary' : 'text-muted-foreground'}`} />
          {file ? (
            <div>
              <p className="font-semibold text-sm">{file.name}</p>
              <p className="text-xs text-muted-foreground mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
          ) : (
            <div>
              <p className="text-sm font-medium text-foreground">Click to browse or drag & drop</p>
              <p className="text-xs text-muted-foreground mt-1">CSV files only (.csv)</p>
            </div>
          )}
        </div>

        <div className="mt-4 flex gap-3">
          <Button onClick={handleUpload} disabled={!file || isActive || !backendConfigured} className="gap-2">
            {isActive ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {isActive ? 'Processing...' : 'Upload & Import'}
          </Button>
          {file && !isActive && (
            <Button variant="outline" onClick={() => { setFile(null); setPhase('idle'); setError(null); }}>Clear</Button>
          )}
        </div>
      </div>

      {/* Status */}
      {phase !== 'idle' && (
        <div className={`border rounded-2xl p-6 ${
          phase === 'error' ? 'bg-red-50 border-red-200' :
          phase === 'done'  ? 'bg-emerald-50 border-emerald-200' :
                              'bg-blue-50 border-blue-200'
        }`}>
          <div className="flex items-center gap-3 mb-4">
            {phase === 'error' ? <XCircle className="w-5 h-5 text-destructive" /> :
             phase === 'done'  ? <CheckCircle className="w-5 h-5 text-emerald-600" /> :
                                 <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />}
            <h3 className="font-semibold text-sm">
              {phase === 'uploading'  && 'Uploading file to import server...'}
              {phase === 'processing' && (jobStatus?.phase || 'Processing...')}
              {phase === 'done'       && 'Import Complete'}
              {phase === 'error'      && 'Import Failed'}
            </h3>
          </div>

          {phase === 'processing' && jobStatus?.chunksTotal > 0 && (
            <div className="space-y-3">
              <div className="w-full bg-blue-100 rounded-full h-2.5">
                <div className="bg-blue-500 h-2.5 rounded-full transition-all duration-500"
                     style={{ width: `${progressPercent}%` }} />
              </div>
              <div className="flex gap-6 text-sm flex-wrap">
                <span className="text-blue-700 font-medium">{progressPercent}% complete</span>
                <span className="text-muted-foreground">Chunk {jobStatus.currentChunk}/{jobStatus.chunksTotal}</span>
                <span className="text-muted-foreground">{(jobStatus.rowsImported || 0).toLocaleString()} rows imported</span>
              </div>
            </div>
          )}

          {phase === 'error' && error && <p className="text-sm text-destructive">{error}</p>}

          {phase === 'done' && (
            <div className="text-sm text-emerald-700 space-y-1">
              <p>All {(jobStatus?.rowsImported || 0).toLocaleString()} rows imported successfully.</p>
              <p className="text-xs text-muted-foreground">Summaries are being rebuilt in the background.</p>
            </div>
          )}
        </div>
      )}

      {/* Import History */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="section-title">Import History</h2>
          <Button variant="ghost" size="sm" onClick={refreshLogs}><RefreshCw className="w-4 h-4" /></Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {['File', 'Uploaded By', 'Started', 'Status', 'Total Rows', 'Imported', 'Skipped', 'Failed', ''].map(h => (
                  <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <>
                  <tr key={log.id}
                    className="border-t border-border hover:bg-muted/40 transition-colors cursor-pointer"
                    onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}>
                    <td className="py-3 px-4 font-medium text-xs max-w-32 truncate">{log.file_name}</td>
                    <td className="py-3 px-4 text-muted-foreground text-xs">{log.uploaded_by}</td>
                    <td className="py-3 px-4 text-muted-foreground text-xs">
                      {log.upload_started_at ? new Date(log.upload_started_at).toLocaleString() : '—'}
                    </td>
                    <td className="py-3 px-4"><StatusBadge status={log.status} /></td>
                    <td className="py-3 px-4">{log.total_rows_in_file?.toLocaleString()}</td>
                    <td className="py-3 px-4 text-emerald-600 font-medium">{log.rows_imported?.toLocaleString()}</td>
                    <td className="py-3 px-4 text-muted-foreground">{log.rows_skipped?.toLocaleString()}</td>
                    <td className="py-3 px-4 text-destructive">{log.rows_failed?.toLocaleString()}</td>
                    <td className="py-3 px-4">
                      {expandedLog === log.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </td>
                  </tr>
                  {expandedLog === log.id && (
                    <tr key={`${log.id}-detail`} className="border-t border-border bg-muted/30">
                      <td colSpan={9} className="px-6 py-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                          <div><p className="text-xs text-muted-foreground">Started</p><p className="font-semibold text-xs">{log.upload_started_at ? new Date(log.upload_started_at).toLocaleString() : '—'}</p></div>
                          <div><p className="text-xs text-muted-foreground">Finished</p><p className="font-semibold text-xs">{log.upload_finished_at ? new Date(log.upload_finished_at).toLocaleString() : '—'}</p></div>
                          <div><p className="text-xs text-muted-foreground">Summary Rebuild</p><p className="font-semibold text-xs">{log.summary_rebuild_status}</p></div>
                          <div><p className="text-xs text-muted-foreground">Rows Updated</p><p className="font-semibold text-xs">{log.rows_updated?.toLocaleString()}</p></div>
                        </div>
                        {log.error_details && (
                          <div className="bg-destructive/5 rounded-lg p-3">
                            <p className="text-xs font-semibold text-destructive mb-1">Error Details</p>
                            <pre className="text-xs text-muted-foreground whitespace-pre-wrap">{log.error_details}</pre>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {!logs.length && (
                <tr><td colSpan={9} className="py-12 text-center text-muted-foreground text-sm">No imports yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}