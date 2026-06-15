import React, { useRef, useState, useCallback } from 'react';
import { Play, Pause, SkipBack, Diamond, ChevronRight, ChevronDown } from 'lucide-react';
import type { ImageAsset, PropKeyframe, TransformProp } from '../types';
import type { T } from '../i18n';
import { getTransformAtTime, upsertPropKeyframe, addKeyframeAllProps } from '../utils/interpolate';

interface BottomPanelProps {
  t: T;
  lang: 'zh' | 'en';
  duration: number;
  currentTime: number;
  setCurrentTime: (t: number) => void;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  assets: ImageAsset[];
  setAssets: (next: ImageAsset[]) => void;
  selectedAssetId: string | null;
  setSelectedAssetId: (id: string | null) => void;
  onAddKeyframe: () => void;
}

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s - Math.floor(s)) * 100);
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
};

type PropRow = { key: string; props: TransformProp[]; label: { zh: string; en: string } };
const PROP_ROWS: PropRow[] = [
  { key: 'pos', props: ['x', 'y'], label: { zh: '位置', en: 'Position' } },
  { key: 'scale', props: ['scale'], label: { zh: '缩放', en: 'Scale' } },
  { key: 'rotation', props: ['rotation'], label: { zh: '旋转', en: 'Rotation' } },
  { key: 'opacity', props: ['opacity'], label: { zh: '不透明度', en: 'Opacity' } },
];

export const BottomPanel: React.FC<BottomPanelProps> = (p) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingCursorRef = useRef(false);
  const [expandedAssets, setExpandedAssets] = useState<Set<string>>(new Set());
  // 左侧属性区宽度（可拖拽调整）
  const [labelWidth, setLabelWidth] = useState(220);
  // 时间轴缩放
  const [viewStart, setViewStart] = useState(0);
  const [viewEnd, setViewEnd] = useState(1);
  // 双击编辑状态
  const [editingVal, setEditingVal] = useState<{ assetId: string; prop: TransformProp } | null>(null);
  const [editInput, setEditInput] = useState('');

  const toggleExpand = (id: string) => {
    setExpandedAssets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const lockSelection = (lock: boolean) => {
    document.body.style.userSelect = lock ? 'none' : '';
    document.body.style.cursor = lock ? 'grabbing' : '';
  };

  // 将屏幕位置转换为时间（考虑 viewStart/viewEnd 缩放）
  const posToTime = (clientX: number) => {
    const el = trackRef.current;
    if (!el || p.duration <= 0) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return (viewStart + ratio * (viewEnd - viewStart)) * p.duration;
  };

  const timeToPercent = (time: number) => {
    const range = viewEnd - viewStart;
    if (range <= 0 || p.duration <= 0) return 0;
    return ((time / p.duration - viewStart) / range) * 100;
  };

  const seekFromEvent = (e: React.MouseEvent | MouseEvent) => {
    p.setCurrentTime(Math.max(0, Math.min(p.duration, posToTime(e.clientX))));
  };

  const onTrackMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    draggingCursorRef.current = true;
    p.setPlaying(false);
    lockSelection(true);
    seekFromEvent(e);
    const onMove = (ev: MouseEvent) => { ev.preventDefault(); if (draggingCursorRef.current) seekFromEvent(ev); };
    const onUp = () => { draggingCursorRef.current = false; lockSelection(false); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // 关键帧拖拽
  const onKfMouseDown = (e: React.MouseEvent, assetId: string, prop: TransformProp, kfTime: number) => {
    e.preventDefault(); e.stopPropagation();
    lockSelection(true);
    let cur = kfTime;
    const onMove = (ev: MouseEvent) => {
      ev.preventDefault();
      const newTime = Math.max(0, Math.min(p.duration, posToTime(ev.clientX)));
      const next = p.assets.map((a) => {
        if (a.id !== assetId) return a;
        const track = a.keyframes[prop].map((kf) => Math.abs(kf.time - cur) < 0.001 ? { ...kf, time: newTime } : kf).sort((x, y) => x.time - y.time);
        return { ...a, keyframes: { ...a.keyframes, [prop]: track } };
      });
      p.setAssets(next); p.setCurrentTime(newTime); cur = newTime;
    };
    const onUp = () => { lockSelection(false); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  };

  // 拖动改值：只修改当前时刻的帧（±0.05s），没有则改 defaultTransform
  const onValDragStart = (e: React.MouseEvent, assetId: string, prop: TransformProp, startVal: number) => {
    e.preventDefault();
    const startX = e.clientX;
    document.body.style.cursor = 'ew-resize'; document.body.style.userSelect = 'none';
    const sensitivity = prop === 'opacity' ? 0.005 : prop === 'scale' ? 0.01 : 1;
    const onMove = (ev: MouseEvent) => {
      let newVal = startVal + (ev.clientX - startX) * sensitivity;
      if (prop === 'opacity') newVal = Math.max(0, Math.min(1, newVal));
      const next = p.assets.map((a) => {
        if (a.id !== assetId) return a;
        const track = a.keyframes[prop];
        // 只修改当前时刻附近的帧
        const exactIdx = track.findIndex((kf) => Math.abs(kf.time - p.currentTime) < 0.05);
        if (exactIdx >= 0) {
          return { ...a, keyframes: { ...a.keyframes, [prop]: track.map((kf, i) => i === exactIdx ? { ...kf, value: newVal } : kf) } };
        }
        // 没有当前时刻的帧 → 修改 defaultTransform
        return { ...a, defaultTransform: { ...a.defaultTransform, [prop]: newVal } };
      });
      p.setAssets(next);
    };
    const onUp = () => { document.body.style.cursor = ''; document.body.style.userSelect = ''; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  };

  // 双击编辑确认
  const commitEdit = (assetId: string, prop: TransformProp) => {
    let val = parseFloat(editInput);
    if (isNaN(val)) { setEditingVal(null); return; }
    if (prop === 'opacity') { val = Math.max(0, Math.min(1, val / 100)); }
    const next = p.assets.map((a) => {
      if (a.id !== assetId) return a;
      const track = a.keyframes[prop];
      const exactIdx = track.findIndex((kf) => Math.abs(kf.time - p.currentTime) < 0.05);
      if (exactIdx >= 0) {
        return { ...a, keyframes: { ...a.keyframes, [prop]: track.map((kf, i) => i === exactIdx ? { ...kf, value: val } : kf) } };
      }
      return { ...a, defaultTransform: { ...a.defaultTransform, [prop]: val } };
    });
    p.setAssets(next);
    setEditingVal(null);
  };

  // 单属性关键帧 toggle：有帧删除，无帧添加
  const togglePropKf = (assetId: string, prop: TransformProp, val: number) => {
    p.setAssets(p.assets.map((a) => {
      if (a.id !== assetId) return a;
      const track = a.keyframes[prop];
      const existIdx = track.findIndex((kf) => Math.abs(kf.time - p.currentTime) < 0.01);
      if (existIdx >= 0) {
        // 已有帧 → 删除
        return { ...a, keyframes: { ...a.keyframes, [prop]: track.filter((_, i) => i !== existIdx) } };
      }
      // 没有帧 → 添加
      const kfVal = a.defaultTransform[prop];
      return { ...a, keyframes: { ...a.keyframes, [prop]: upsertPropKeyframe(track, p.currentTime, kfVal) } };
    }));
  };

  // 总轨道行关键帧拖拽（移动该时间点所有属性的关键帧）
  const onAllPropsKfDrag = (e: React.MouseEvent, assetId: string, kfTime: number) => {
    e.preventDefault(); e.stopPropagation();
    lockSelection(true);
    let cur = kfTime;
    let moved = false;
    const allProps: TransformProp[] = ['x', 'y', 'scale', 'rotation', 'opacity'];
    const onMove = (ev: MouseEvent) => {
      ev.preventDefault();
      const newTime = Math.max(0, Math.min(p.duration, posToTime(ev.clientX)));
      if (Math.abs(newTime - cur) < 0.001) return;
      moved = true;
      const next = p.assets.map((a) => {
        if (a.id !== assetId) return a;
        const newKfs = { ...a.keyframes };
        allProps.forEach((prop) => {
          newKfs[prop] = a.keyframes[prop].map((kf) =>
            Math.abs(kf.time - cur) < 0.001 ? { ...kf, time: newTime } : kf
          ).sort((x, y) => x.time - y.time);
        });
        return { ...a, keyframes: newKfs };
      });
      p.setAssets(next); p.setCurrentTime(newTime); cur = newTime;
    };
    const onUp = () => {
      lockSelection(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!moved) p.setCurrentTime(kfTime);
    };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  };

  // 拖拽分隔条
  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = labelWidth;
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => { setLabelWidth(Math.max(140, Math.min(400, startW + ev.clientX - startX))); };
    const onUp = () => { document.body.style.cursor = ''; document.body.style.userSelect = ''; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  };

  // 缩放条拖拽
  const zoomBarRef = useRef<HTMLDivElement>(null);
  const onZoomBarDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const bar = zoomBarRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const clickRatio = (e.clientX - rect.left) / rect.width;
    // 判断是拖左手柄、右手柄还是中间平移
    const leftHandleR = viewStart;
    const rightHandleR = viewEnd;
    const HANDLE_W = 8 / rect.width;

    let mode: 'left' | 'right' | 'pan' = 'pan';
    if (Math.abs(clickRatio - leftHandleR) < HANDLE_W) mode = 'left';
    else if (Math.abs(clickRatio - rightHandleR) < HANDLE_W) mode = 'right';
    else if (clickRatio < leftHandleR || clickRatio > rightHandleR) {
      // 点击空白区，跳到该位置居中
      const range = viewEnd - viewStart;
      const newStart = Math.max(0, Math.min(1 - range, clickRatio - range / 2));
      setViewStart(newStart); setViewEnd(newStart + range);
      return;
    }
    const startX = e.clientX;
    const startVS = viewStart, startVE = viewEnd;
    document.body.style.cursor = mode === 'pan' ? 'grab' : 'ew-resize'; document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      const dx = (ev.clientX - startX) / rect.width;
      if (mode === 'left') { setViewStart(Math.max(0, Math.min(startVE - 0.02, startVS + dx))); }
      else if (mode === 'right') { setViewEnd(Math.min(1, Math.max(startVS + 0.02, startVE + dx))); }
      else { const range = startVE - startVS; const ns = Math.max(0, Math.min(1 - range, startVS + dx)); setViewStart(ns); setViewEnd(ns + range); }
    };
    const onUp = () => { document.body.style.cursor = ''; document.body.style.userSelect = ''; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  };

  const cursorPercent = timeToPercent(p.currentTime);
  const ROW_H = 'h-7';
  const RULER_H = 'h-7';
  const visibleRange = viewEnd - viewStart;
  const tickCount = Math.max(3, Math.min(20, Math.round(10 / visibleRange)));

  return (
    <div className="shrink-0 border-t border-[var(--border-soft)] bg-[var(--bg-elev)]/60 backdrop-blur-md select-none flex flex-col" style={{ height: 260 }}>
      {/* 播放控制栏 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-soft)] shrink-0">
        <div className="flex items-center gap-2.5">
          <button onClick={() => { p.setCurrentTime(0); p.setPlaying(false); }} className="btn-ghost !py-1 !px-2"><SkipBack size={14} /></button>
          <button onClick={() => p.setPlaying(!p.playing)} className="btn-ghost !py-1 !px-2">
            {p.playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <span className="text-[12px] font-mono text-neutral-300 pointer-events-none">
            {fmt(p.currentTime)} <span className="text-neutral-600">/</span> {fmt(p.duration)}
          </span>
        </div>
        {p.selectedAssetId && (
          <button onClick={p.onAddKeyframe} className="btn-ghost !py-1 !px-2.5 text-[11px]">
            <Diamond size={12} /> {p.lang === 'zh' ? '全属性帧' : 'All KF'}
          </button>
        )}
      </div>

      {/* 缩放横条（时间轴范围控制器） */}
      <div className="shrink-0 flex items-center border-b border-[var(--border-soft)] bg-[var(--bg-elev-2)]">
        <div style={{ width: labelWidth }} className="shrink-0 border-r border-[var(--border-soft)] h-5" />
        <div ref={zoomBarRef} className="flex-1 relative h-5 cursor-pointer" onMouseDown={onZoomBarDown}>
          <div className="absolute inset-y-1 left-0 right-0 bg-neutral-800/60 rounded-full" />
          {/* 可见范围条 */}
          <div className="absolute top-1 bottom-1 rounded-full bg-neutral-600/80 hover:bg-neutral-500/80 transition-colors"
            style={{ left: `${viewStart * 100}%`, right: `${(1 - viewEnd) * 100}%` }}
          >
            {/* 左手柄 */}
            <div className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize rounded-l-full bg-neutral-400/60 hover:bg-[var(--primary)]/80" />
            {/* 右手柄 */}
            <div className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize rounded-r-full bg-neutral-400/60 hover:bg-[var(--primary)]/80" />
          </div>
        </div>
      </div>

      {/* 时间轴 + 属性轨道 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧标签列 */}
        <div style={{ width: labelWidth }} className="shrink-0 border-r border-[var(--border-soft)] flex flex-col relative">
          <div className={`${RULER_H} shrink-0 border-b border-[var(--border-soft)]`} />
          <div className="flex-1 overflow-y-auto scroll-area">
            {p.assets.map((a) => {
              const sel = a.id === p.selectedAssetId;
              const expanded = expandedAssets.has(a.id);
              const assetTr = getTransformAtTime(a.keyframes, p.currentTime, a.defaultTransform);
              return (
                <div key={a.id}>
                  <div className={`${ROW_H} flex items-center px-2 gap-1.5 cursor-pointer border-b border-[var(--border-soft)] ${sel ? 'bg-[var(--primary)]/8' : 'hover:bg-white/[0.03]'}`}>
                    <button onClick={(e) => { e.stopPropagation(); toggleExpand(a.id); }} className="text-neutral-500 hover:text-neutral-200 p-0.5 shrink-0">
                      {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                    <img src={a.src} alt="" className="w-5 h-5 object-contain rounded shrink-0" draggable={false} />
                    <span className="text-[11px] text-neutral-200 truncate flex-1" onClick={() => p.setSelectedAssetId(a.id)}>{a.name}</span>
                  </div>
                  {expanded && PROP_ROWS.map((row) => {
                    const hasKf = row.props.some((pr) => a.keyframes[pr].some((kf) => Math.abs(kf.time - p.currentTime) < 0.01));
                    return (
                      <div key={row.key} className={`${ROW_H} flex items-center justify-between pl-7 pr-2 border-b border-[var(--border-soft)]/50`}>
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => row.props.forEach((pr) => togglePropKf(a.id, pr, assetTr[pr]))}
                            className={`p-0.5 ${hasKf ? 'text-yellow-400' : 'text-neutral-600 hover:text-yellow-400'}`}
                            title={hasKf ? (p.lang === 'zh' ? '删除关键帧' : 'Delete KF') : (p.lang === 'zh' ? '添加关键帧' : 'Add KF')}>
                            <Diamond size={10} className={hasKf ? 'fill-yellow-400' : ''} />
                          </button>
                          <span className="text-[11px] text-neutral-400 shrink-0">{row.label[p.lang]}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {row.props.map((pr) => {
                            const val = assetTr[pr];
                            const display = pr === 'opacity' ? `${Math.round(val * 100)}%` : pr === 'scale' ? val.toFixed(2) : pr === 'rotation' ? `${val.toFixed(1)}°` : val.toFixed(1);
                            const isEditing = editingVal?.assetId === a.id && editingVal?.prop === pr;
                            return isEditing ? (
                              <input key={pr}
                                autoFocus
                                className="w-16 text-[11px] font-mono bg-neutral-900 border border-[var(--primary)] rounded px-1 py-0.5 text-white outline-none"
                                value={editInput}
                                onChange={(e) => setEditInput(e.target.value)}
                                onBlur={() => commitEdit(a.id, pr)}
                                onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(a.id, pr); if (e.key === 'Escape') setEditingVal(null); }}
                              />
                            ) : (
                              <span key={pr} className="text-[11px] font-mono text-[var(--primary)] cursor-ew-resize hover:text-white select-none px-1 py-0.5 rounded hover:bg-white/5"
                                onMouseDown={(e) => onValDragStart(e, a.id, pr, val)}
                                onDoubleClick={() => {
                                  const editVal = pr === 'opacity' ? `${Math.round(val * 100)}` : pr === 'rotation' ? val.toFixed(1) : pr === 'scale' ? val.toFixed(2) : val.toFixed(1);
                                  setEditingVal({ assetId: a.id, prop: pr }); setEditInput(editVal);
                                }}>
                                {row.props.length > 1 ? `${pr.toUpperCase()} ${display}` : display}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {/* 拖拽分隔条 */}
          <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--primary)]/40 transition-colors z-20" onMouseDown={onResizeStart} />
        </div>

        {/* 右侧轨道区 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Ruler */}
          <div ref={trackRef} className={`relative ${RULER_H} shrink-0 bg-[var(--bg-elev-2)] border-b border-[var(--border-soft)] cursor-pointer`} onMouseDown={onTrackMouseDown}>
            {p.duration > 0 && Array.from({ length: tickCount + 1 }).map((_, i) => {
              const ratio = i / tickCount;
              const time = (viewStart + ratio * visibleRange) * p.duration;
              return (
                <div key={i} className="absolute top-0 h-full pointer-events-none" style={{ left: `${ratio * 100}%` }}>
                  <div className="w-px h-2.5 bg-neutral-700" />
                  <span className="text-[9px] text-neutral-500 font-mono absolute top-2.5 -translate-x-1/2">{fmt(time)}</span>
                </div>
              );
            })}
            {cursorPercent >= 0 && cursorPercent <= 100 && (
              <div className="absolute top-0 h-full w-0.5 bg-[var(--primary)] pointer-events-none" style={{ left: `${cursorPercent}%` }}>
                <div className="w-3 h-3 bg-[var(--primary)] rounded-sm absolute -top-0.5 -translate-x-1/2 rotate-45" />
              </div>
            )}
          </div>

          {/* 轨道内容 */}
          <div className="flex-1 overflow-y-auto scroll-area">
            {p.assets.map((a) => {
              const sel = a.id === p.selectedAssetId;
              const expanded = expandedAssets.has(a.id);
              const allTimes = new Set<number>();
              PROP_ROWS.forEach((row) => row.props.forEach((prop) => a.keyframes[prop].forEach((kf) => allTimes.add(Math.round(kf.time * 1000) / 1000))));

              return (
                <div key={a.id}>
                  <div className={`relative ${ROW_H} border-b border-[var(--border-soft)] ${sel ? 'bg-[var(--primary)]/5' : ''}`}>
                    {cursorPercent >= 0 && cursorPercent <= 100 && <div className="absolute top-0 h-full w-0.5 bg-[var(--primary)]/40 pointer-events-none" style={{ left: `${cursorPercent}%` }} />}
                    {a.visible && <div className="absolute top-1.5 bottom-1.5 left-0 right-0 bg-neutral-800/40 rounded-sm mx-0.5" />}
                    {Array.from(allTimes).map((kfTime, idx) => {
                      const left = timeToPercent(kfTime);
                      if (left < -2 || left > 102) return null;
                      return (
                        <div key={idx} className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 cursor-ew-resize hover:scale-125 transition-transform"
                          style={{ left: `${left}%` }}
                          onMouseDown={(e) => onAllPropsKfDrag(e, a.id, kfTime)}>
                          <Diamond size={9} className="text-yellow-400 fill-yellow-400/60" />
                        </div>
                      );
                    })}
                  </div>
                  {expanded && PROP_ROWS.map((row) => (
                    <div key={row.key} className={`relative ${ROW_H} border-b border-[var(--border-soft)]/50`}>
                      {cursorPercent >= 0 && cursorPercent <= 100 && <div className="absolute top-0 h-full w-0.5 bg-[var(--primary)]/30 pointer-events-none" style={{ left: `${cursorPercent}%` }} />}
                      {row.props.map((prop) =>
                        a.keyframes[prop].map((kf, idx) => {
                          const left = timeToPercent(kf.time);
                          if (left < -2 || left > 102) return null;
                          return (
                            <div key={`${prop}-${idx}`}
                              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-ew-resize hover:scale-150 transition-transform z-10"
                              style={{ left: `${left}%` }}
                              onMouseDown={(e) => onKfMouseDown(e, a.id, prop, kf.time)}
                              title={`${prop} ${fmt(kf.time)}`}>
                              <Diamond size={10} className="text-yellow-400 fill-yellow-400" />
                            </div>
                          );
                        })
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};