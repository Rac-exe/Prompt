import React, { useEffect, useState } from 'react';

interface ProjectStatusData {
  projectId: string | null;
  name?: string;
  status?: 'indexing' | 'ready' | 'stale';
  branch?: string;
  auto?: boolean;
  progress?: { current: number; total: number };
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  ready:    { color: '#5a9e7a', bg: 'rgba(90, 158, 122, 0.12)', label: 'Ready' },
  indexing: { color: '#c8a96e', bg: 'rgba(200, 169, 110, 0.12)', label: 'Indexing' },
  stale:    { color: '#c0504a', bg: 'rgba(192, 80, 74, 0.12)',  label: 'Needs re-index' },
};

const ProjectStatus: React.FC = () => {
  const [projectData, setProjectData] = useState<ProjectStatusData | null>(null);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.project?.onOverlayStatus) return;

    const unsub = api.project.onOverlayStatus((data: ProjectStatusData | null) => {
      setProjectData(data);
    });

    return () => unsub?.();
  }, []);

  if (!projectData || !projectData.projectId) {
    return null;
  }

  const status = projectData.status || 'stale';
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.stale;
  const pct = status === 'indexing' && projectData.progress
    ? Math.round((projectData.progress.current / projectData.progress.total) * 100)
    : null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px 3px 8px',
        borderRadius: 8,
        backgroundColor: config.bg,
        fontSize: 10,
        fontWeight: 600,
        color: config.color,
        letterSpacing: '0.01em',
        maxWidth: 220,
        overflow: 'hidden',
        border: `1px solid ${config.color}22`,
        transition: 'all 0.2s ease',
      }}
    >
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: config.color,
          flexShrink: 0,
          boxShadow: `0 0 6px ${config.color}66`,
          animation: status === 'indexing' ? 'pulse 1.5s ease-in-out infinite' : undefined,
        }}
      />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {projectData.name || 'Project'}
        {projectData.branch && (
          <span style={{ opacity: 0.6, fontWeight: 500 }}> / {projectData.branch}</span>
        )}
      </span>
      {pct !== null && (
        <span style={{ opacity: 0.8, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
          {pct}%
        </span>
      )}
    </div>
  );
};

export default React.memo(ProjectStatus);
