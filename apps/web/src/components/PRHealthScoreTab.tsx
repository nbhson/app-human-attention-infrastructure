import { useState } from 'react';
import type { PRHealthScore, HealthRating, OverallRiskLevel } from '../api/reviews';
import { Activity, AlertTriangle, CheckCircle2, Layers, ShieldCheck, Zap } from './Icons';

const HEALTH_COLORS: Record<HealthRating, string> = {
  excellent: 'var(--color-success)',
  good: '#22c55e',
  fair: 'var(--color-warning)',
  poor: 'var(--color-danger)',
};

const HEALTH_GRADIENTS: Record<HealthRating, string> = {
  excellent: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
  good: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
  fair: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
  poor: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
};

const RISK_COLORS: Record<OverallRiskLevel, string> = {
  LOW: 'var(--color-success)',
  MEDIUM: 'var(--color-warning)',
  HIGH: 'var(--color-danger)',
  CRITICAL: '#dc2626',
};

const RISK_BG: Record<OverallRiskLevel, string> = {
  LOW: 'rgba(22, 163, 74, 0.12)',
  MEDIUM: 'rgba(245, 158, 11, 0.12)',
  HIGH: 'rgba(239, 68, 68, 0.12)',
  CRITICAL: 'rgba(220, 38, 38, 0.15)',
};

const CATEGORY_CONFIG = [
  {
    key: 'architecture',
    label: 'Architecture',
    icon: Layers,
    desc: 'Structural patterns, coupling, design principles',
  },
  {
    key: 'codeQuality',
    label: 'Code Quality',
    icon: CheckCircle2,
    desc: 'Findings density, complexity, maintainability',
  },
  { key: 'security', label: 'Security', icon: ShieldCheck, desc: 'Auth, secrets, injection, crypto vulnerabilities' },
  { key: 'performance', label: 'Performance', icon: Zap, desc: 'Memory leaks, latency, regression risks' },
  { key: 'testing', label: 'Testing', icon: Activity, desc: 'Test coverage, test-to-source ratio' },
] as const;

const RATING_SCORE: Record<HealthRating, number> = {
  excellent: 95,
  good: 75,
  fair: 50,
  poor: 25,
};

const RISK_SCORE: Record<OverallRiskLevel, number> = {
  LOW: 15,
  MEDIUM: 45,
  HIGH: 75,
  CRITICAL: 95,
};

function RatingBadge({ rating }: { readonly rating: HealthRating }): JSX.Element {
  const color = HEALTH_COLORS[rating];
  const gradient = HEALTH_GRADIENTS[rating];
  const score = RATING_SCORE[rating];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: gradient,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: `0 4px 12px ${color}40`,
        }}
      >
        <span style={{ fontSize: '1.15rem', fontWeight: 700, color: '#fff', fontFamily: 'var(--font-mono)' }}>
          {score}
        </span>
      </div>
      <div>
        <div
          style={{
            fontSize: '0.65rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {rating.toUpperCase()}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', marginTop: 2 }}>{score}/100</div>
      </div>
    </div>
  );
}

function GradientBar({
  value,
  color,
  gradient,
}: {
  readonly value: number;
  readonly color: string;
  readonly gradient: string;
}): JSX.Element {
  return (
    <div
      style={{ position: 'relative', height: 8, borderRadius: 4, background: 'var(--color-bg)', overflow: 'hidden' }}
    >
      <div
        style={{
          width: `${value}%`,
          height: '100%',
          borderRadius: 4,
          background: gradient,
          boxShadow: `0 0 8px ${color}60`,
          transition: 'width 1s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      />
    </div>
  );
}

function RadarChart({ scores }: { readonly scores: readonly number[] }): JSX.Element {
  const centerX = 100;
  const centerY = 100;
  const radius = 75;
  const levels = 4;
  const angleStep = (Math.PI * 2) / 5;

  const getPoint = (value: number, index: number) => {
    const angle = index * angleStep - Math.PI / 2;
    const r = (value / 100) * radius;
    return { x: centerX + r * Math.cos(angle), y: centerY + r * Math.sin(angle) };
  };

  const gridPoints = (level: number) => {
    const r = (level / levels) * radius;
    return Array.from({ length: 5 }, (_, i) => {
      const angle = i * angleStep - Math.PI / 2;
      return `${centerX + r * Math.cos(angle)},${centerY + r * Math.sin(angle)}`;
    }).join(' ');
  };

  const dataPoints = scores.map((score, i) => getPoint(score, i));
  const dataPolygon = dataPoints.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <svg viewBox="0 0 200 200" width="200" height="200" style={{ transform: 'rotate(-90deg)' }}>
      <defs>
        <linearGradient id="radarFill" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#22c55e" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#16a34a" stopOpacity="0.05" />
        </linearGradient>
        <linearGradient id="radarStroke" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#22c55e" />
          <stop offset="100%" stopColor="#16a34a" />
        </linearGradient>
      </defs>

      {/* Grid polygons */}
      {Array.from({ length: levels }, (_, i) => i + 1).map((level) => (
        <polygon
          key={level}
          points={gridPoints(level)}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth="1"
          strokeDasharray="4,4"
        />
      ))}

      {/* Axis lines */}
      {Array.from({ length: 5 }, (_, i) => {
        const angle = i * angleStep - Math.PI / 2;
        return (
          <line
            key={i}
            x1={centerX}
            y1={centerY}
            x2={centerX + radius * Math.cos(angle)}
            y2={centerY + radius * Math.sin(angle)}
            stroke="var(--color-border)"
            strokeWidth="1"
          />
        );
      })}

      {/* Data polygon */}
      <polygon points={dataPolygon} fill="url(#radarFill)" stroke="url(#radarStroke)" strokeWidth="2" />

      {/* Data points */}
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={4} fill="var(--color-success)" stroke="#fff" strokeWidth="1.5" />
      ))}
    </svg>
  );
}

function CategoryCard({
  label,
  icon: Icon,
  desc,
  rating,
}: {
  readonly label: string;
  readonly icon: React.ComponentType<{ readonly size?: number; readonly className?: string }>;
  readonly desc: string;
  readonly rating: HealthRating;
}): JSX.Element {
  const color = HEALTH_COLORS[rating];
  const gradient = HEALTH_GRADIENTS[rating];
  const score = RATING_SCORE[rating];
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      style={{
        padding: '20px 24px',
        borderRadius: 16,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        boxShadow: isHovered ? 'var(--shadow-elevated)' : 'var(--shadow-card)',
        transition: 'all 0.3s ease',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: gradient }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: `${color}18`,
            color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Icon size={20} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text)' }}>{label}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: 2, lineHeight: 1.4 }}>
                {desc}
              </div>
            </div>
            <RatingBadge rating={rating} />
          </div>
          <div style={{ marginTop: 14 }}>
            <GradientBar value={score} color={color} gradient={gradient} />
          </div>
        </div>
      </div>
    </div>
  );
}

function RiskGauge({ risk }: { readonly risk: OverallRiskLevel }): JSX.Element {
  const color = RISK_COLORS[risk];
  const score = RISK_SCORE[risk];
  const radius = 60;
  const strokeWidth = 8;
  const circumference = 2 * Math.PI * (radius - strokeWidth / 2);
  const offset = circumference * (1 - score / 100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      <div style={{ position: 'relative', width: 140, height: 140 }}>
        <svg width="140" height="140" style={{ transform: 'rotate(-90deg)' }}>
          <circle
            cx="70"
            cy="70"
            r={radius - strokeWidth / 2}
            fill="none"
            stroke="var(--color-border)"
            strokeWidth={strokeWidth}
          />
          <circle
            cx="70"
            cy="70"
            r={radius - strokeWidth / 2}
            fill="none"
            stroke="url(#riskGradient)"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{
              transition: 'stroke-dashoffset 1.5s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          />
          <defs>
            <linearGradient id="riskGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={color} />
              <stop offset="100%" stopColor={color} stopOpacity="0.7" />
            </linearGradient>
          </defs>
        </svg>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
          }}
        >
          <span
            style={{
              fontSize: '2.2rem',
              fontWeight: 800,
              color: 'var(--color-text)',
              fontFamily: 'var(--font-mono)',
              lineHeight: 1,
            }}
          >
            {score}
          </span>
          <span
            style={{
              fontSize: '0.62rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--color-text-muted)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            Risk Score
          </span>
        </div>
      </div>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 16px',
          borderRadius: 999,
          background: RISK_BG[risk],
          border: `1px solid ${color}40`,
        }}
      >
        <div style={{ color, display: 'inline-flex' }}>
          <AlertTriangle size={15} />
        </div>
        <span
          style={{ fontSize: '0.82rem', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.05em' }}
        >
          {risk}
        </span>
      </div>
      <p
        style={{
          margin: 0,
          fontSize: '0.78rem',
          color: 'var(--color-text-subtle)',
          textAlign: 'center',
          maxWidth: 280,
          lineHeight: 1.4,
        }}
      >
        {getRiskDescription(risk)}
      </p>
    </div>
  );
}

export function PRHealthScoreTab({ healthScore }: { readonly healthScore: PRHealthScore | undefined }): JSX.Element {
  if (!healthScore) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-text-muted)' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
        <h3 style={{ margin: '0 0 8px', fontSize: '1.1rem', color: 'var(--color-text)' }}>No Health Score Available</h3>
        <p style={{ margin: 0, fontSize: '0.85rem', maxWidth: 320 }}>
          Health scores are computed from review findings and PR composition. Run a review to see the analysis.
        </p>
      </div>
    );
  }

  const categories = CATEGORY_CONFIG.map((c) => ({
    ...c,
    rating: healthScore[c.key as keyof Omit<PRHealthScore, 'overallRisk'>] as HealthRating,
  }));

  const radarScores = categories.map((c) => RATING_SCORE[c.rating]);

  return (
    <div style={{ width: '100%', boxSizing: 'border-box' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text)' }}>
          PR Health Score
        </h2>
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
          Multi-dimensional analysis of this pull request's health across 5 key dimensions
        </p>
      </div>

      {/* Top Row: Radar Chart + Risk Gauge */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 20,
          marginBottom: 20,
        }}
      >
        {/* Radar Chart */}
        <section
          style={{
            padding: '20px 24px',
            borderRadius: 16,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <div
                style={{
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--color-text-muted)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                Health Profile
              </div>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text)', marginTop: 2 }}>
                5-Dimensional Radar View
              </div>
            </div>
            <div
              style={{
                fontSize: '0.65rem',
                color: 'var(--color-text-faint)',
                fontFamily: 'var(--font-mono)',
                background: 'var(--color-surface-muted)',
                padding: '4px 10px',
                borderRadius: 999,
              }}
            >
              Higher = Better
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
            <RadarChart scores={radarScores} />
          </div>
          {/* Legend */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14, justifyContent: 'center' }}>
            {categories.map((cat) => (
              <div
                key={cat.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: '0.68rem',
                  color: 'var(--color-text-muted)',
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: 2, background: HEALTH_GRADIENTS[cat.rating] }} />
                {cat.label}
              </div>
            ))}
          </div>
        </section>

        {/* Risk Gauge */}
        <section
          style={{
            padding: '20px 24px',
            borderRadius: 16,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-card)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: 6 }}>
            <div
              style={{
                fontSize: '0.68rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--color-text-muted)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              Overall Risk Level
            </div>
            <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text)', marginTop: 2 }}>
              Composite Assessment
            </div>
          </div>
          <RiskGauge risk={healthScore.overallRisk} />
        </section>
      </div>

      {/* Category Breakdown */}
      <section
        style={{
          padding: '20px 24px',
          borderRadius: 16,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: '0.68rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--color-text-muted)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            Dimension Breakdown
          </div>
          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text)', marginTop: 2 }}>
            Detailed scores and progress bars for each dimension
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
          {categories.map((cat) => (
            <CategoryCard key={cat.key} label={cat.label} icon={cat.icon} desc={cat.desc} rating={cat.rating} />
          ))}
        </div>
      </section>

      {/* Methodology */}
      <section style={{ marginTop: 20 }}>
        <details style={{ cursor: 'pointer' }}>
          <summary
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 14px',
              borderRadius: 10,
              background: 'var(--color-surface-muted)',
              border: '1px solid var(--color-border)',
              fontSize: '0.78rem',
              fontWeight: 600,
              color: 'var(--color-text)',
              listStyle: 'none',
            }}
          >
            <div style={{ color: 'var(--color-text-muted)', display: 'inline-flex' }}>
              <AlertTriangle size={14} />
            </div>
            How this score is calculated
          </summary>
          <div
            style={{
              marginTop: 12,
              padding: 16,
              borderRadius: 10,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
            }}
          >
            <ul
              style={{
                margin: 0,
                paddingLeft: 20,
                fontSize: '0.75rem',
                color: 'var(--color-text-muted)',
                lineHeight: 1.8,
              }}
            >
              <li>
                <strong>Architecture</strong> — Structural patterns, coupling, and design principles in changed files.
                Penalized by CRITICAL/MAJOR findings in core modules.
              </li>
              <li>
                <strong>Code Quality</strong> — Findings density, cyclomatic complexity signals, and maintainability.
                Based on total actionable findings count.
              </li>
              <li>
                <strong>Security</strong> — Keyword detection for auth, secrets, injection, XSS, SQL, crypto, TLS/cert
                issues across findings and file paths.
              </li>
              <li>
                <strong>Performance</strong> — Keyword detection for memory leaks, latency, N+1 queries, missing
                indexes, cache issues, regression signals.
              </li>
              <li>
                <strong>Testing</strong> — Test-to-source file ratio from PR composition. 50%+ = excellent, 25%+ = good,
                above 0% = fair, 0% = poor.
              </li>
              <li>
                <strong>Overall Risk</strong> — Composite: CRITICAL findings or 2+ security issues = HIGH; 3+ MAJOR or
                any security/perf issues = MEDIUM; else LOW.
              </li>
            </ul>
          </div>
        </details>
      </section>
    </div>
  );
}

function getRiskDescription(risk: OverallRiskLevel): string {
  switch (risk) {
    case 'LOW':
      return 'Minimal risk — changes are well-contained and follow established patterns.';
    case 'MEDIUM':
      return 'Moderate risk — some areas need attention but no critical blockers.';
    case 'HIGH':
      return 'High risk — significant concerns that should be addressed before merge.';
    case 'CRITICAL':
      return 'Critical risk — fundamental issues that likely block merge.';
  }
}
