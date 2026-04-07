import React, { useEffect, useState } from 'react';

interface ProjectStatusData {
  projectId: string | null;
  name?: string;
  status?: 'indexing' | 'ready' | 'stale';
  branch?: string;
  auto?: boolean;
  progress?: { current: number; total: number };
}

const STATUS_COLORS: Record<string, string> = {
  ready: '#5a9e7a',
  indexing: '#c8a96e',
  stale: '#c0504a',
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
  const dotColor = STATUS_COLORS[status] || STATUS_COLORS.stale;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 8px',
        borderRadius: 6,
        backgroundColor: 'hsl(var(--muted) / 0.5)',
        fontSize: 10,
        fontWeight: 500,
        color: 'hsl(var(--muted-foreground))',
        letterSpacing: '0.02em',
        maxWidth: 200,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: dotColor,
          flexShrink: 0,
          animation: status === 'indexing' ? 'pulse 1.5s ease-in-out infinite' : undefined,
        }}
      />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {projectData.name || 'Project'}
        {projectData.branch && (
          <span style={{ opacity: 0.7 }}> · {projectData.branch}</span>
        )}
      </span>
      {status === 'indexing' && projectData.progress && (
        <span style={{ opacity: 0.6, flexShrink: 0 }}>
          {Math.round((projectData.progress.current / projectData.progress.total) * 100)}%
        </span>
      )}
    </div>
  );
};

export default React.memo(ProjectStatus);
