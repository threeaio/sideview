// Transport: einzige Stelle, die window.canvasBridge anfasst. Services rufen nur diese Funktionen.

import type { Annotation, CanvasState, CanvasSummary, RemovedItems, RemovedVersions } from "../../shared/contracts.ts";
import type { Settings } from "../../shared/settings.ts";
import type { UsageSummary } from "../../shared/usage.ts";
import type { VoiceResult } from "../../shared/voice.ts";
import { EVENTS, INVOKE, type CanvasBridge, type OpenReview, type OpenedEvent, type RawBridge, type Stage, type VoiceStatus } from "../../shared/ipc.ts";

declare global {
  interface Window {
    canvasBridge: RawBridge;
  }
}

const raw = () => window.canvasBridge;

export const bridge: CanvasBridge = {
  list: () => raw().invoke(INVOKE.list) as Promise<CanvasSummary[]>,
  get: (name) => raw().invoke(INVOKE.get, name) as Promise<CanvasState | null>,
  current: () => raw().invoke(INVOKE.current) as Promise<OpenedEvent | null>,
  addImages: (canvas, paths, at) => raw().invoke(INVOKE.addImages, canvas, paths, at) as Promise<CanvasState>,
  pasteImage: (canvas, at) => raw().invoke(INVOKE.pasteImage, canvas, at) as Promise<CanvasState | null>,
  nativePaste: () => raw().invoke(INVOKE.nativePaste) as Promise<void>,
  pathForFile: (file) => raw().pathForFile(file),
  applyLayout: (canvas, layout) => raw().invoke(INVOKE.applyLayout, canvas, layout) as Promise<void>,
  removeItems: (canvas, ids) => raw().invoke(INVOKE.removeItems, canvas, ids) as Promise<RemovedItems>,
  restoreItems: (canvas, removed) => raw().invoke(INVOKE.restoreItems, canvas, removed) as Promise<void>,
  removeVersions: (canvas, itemId, indices) => raw().invoke(INVOKE.removeVersions, canvas, itemId, indices) as Promise<RemovedVersions>,
  restoreVersions: (canvas, removed) => raw().invoke(INVOKE.restoreVersions, canvas, removed) as Promise<void>,
  addAnnotation: (canvas, input) => raw().invoke(INVOKE.addAnnotation, canvas, input) as Promise<Annotation>,
  updateAnnotation: (canvas, id, patch) => raw().invoke(INVOKE.updateAnnotation, canvas, id, patch) as Promise<Annotation>,
  removeAnnotation: (canvas, id) => raw().invoke(INVOKE.removeAnnotation, canvas, id) as Promise<void>,
  restoreAnnotation: (canvas, annotation, index) => raw().invoke(INVOKE.restoreAnnotation, canvas, annotation, index) as Promise<void>,
  finish: (canvas) => raw().invoke(INVOKE.finish, canvas) as Promise<string[]>,
  openReviews: () => raw().invoke(INVOKE.openReviews) as Promise<OpenReview[]>,
  voice: (request) => raw().invoke(INVOKE.voice, request) as Promise<VoiceResult>,
  voiceLog: (event, data) => raw().invoke(INVOKE.voiceLog, event, data) as Promise<void>,
  settings: () => raw().invoke(INVOKE.settings) as Promise<Settings>,
  saveSettings: (settings) => raw().invoke(INVOKE.saveSettings, settings) as Promise<Settings>,
  usage: () => raw().invoke(INVOKE.usage) as Promise<UsageSummary>,
  voiceStatus: () => raw().invoke(INVOKE.voiceStatus) as Promise<VoiceStatus>,
  setDecisionKey: (key) => raw().invoke(INVOKE.setDecisionKey, key) as Promise<boolean>,
  openCanvas: (name) => raw().invoke(INVOKE.openCanvas, name) as Promise<CanvasState>,
  createCanvas: (title) => raw().invoke(INVOKE.createCanvas, title) as Promise<CanvasState>,
  thumbnail: (request) => raw().invoke(INVOKE.thumbnail, request) as Promise<string | null>,
  invokeExtension: (channel, ...args) => raw().invokeExtension(channel, ...args),
  onOpened: (cb) => raw().on(EVENTS.opened, (p) => cb(p as OpenedEvent)),
  onChanged: (cb) => raw().on(EVENTS.changed, (p) => cb(p as CanvasState)),
  onReviews: (cb) => raw().on(EVENTS.reviews, (p) => cb(p as OpenReview[])),
  onStage: (cb) => raw().on(EVENTS.stage, (p) => cb(p as Stage)),
  onOpenSettings: (cb) => raw().on(EVENTS.openSettings, () => cb()),
  onOpenCanvases: (cb) => raw().on(EVENTS.openCanvases, () => cb()),
  onNewCanvas: (cb) => raw().on(EVENTS.newCanvas, () => cb()),
  onUndo: (cb) => raw().on(EVENTS.undo, () => cb()),
  onRedo: (cb) => raw().on(EVENTS.redo, () => cb()),
  onPaste: (cb) => raw().on(EVENTS.paste, () => cb()),
};
