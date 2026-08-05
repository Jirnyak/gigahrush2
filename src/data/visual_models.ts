export type MeshMaterialId =
  | 'concrete'
  | 'dark_concrete'
  | 'rust_metal'
  | 'painted_metal'
  | 'wood'
  | 'plastic'
  | 'cloth'
  | 'glass_dim'
  | 'emissive_lamp'
  | 'emissive_screen'
  | 'meat'
  | 'bone';

export type VisualModelId =
  | 'pipe_wall_small'
  | 'pipe_wall_large'
  | 'button_panel'
  | 'cable_wall_loose'
  | 'ceiling_cable'
  | 'wall_panel_flat'
  | 'wall_panel_screen'
  | 'organic_wall_veins'
  | 'organic_wall_ribs'
  | 'ceiling_beam'
  | 'ceiling_bulb'
  | 'ceiling_light_panel'
  | 'organic_ceiling_tendrils'
  | 'meat_ceiling_lamp'
  | 'chandelier_ornate'
  | 'column_hint'
  | 'furniture_table_hint'
  | 'furniture_shelf_hint'
  | 'machine_panel'
  | 'apparatus_frame'
  | 'rubble_chunk'
  | 'floor_tile_shard'
  | 'brick_fragment'
  | 'collector_floor_pipe'
  | 'linoleum_peel'
  | 'linoleum_scrap'
  | 'paper_sheet'
  | 'newspaper_sheet'
  | 'floor_crumb'
  | 'organic_thread'
  | 'column_concrete_square'
  | 'column_concrete_round'
  | 'organic_column_bone'
  | 'table_slab'
  | 'desk_slab'
  | 'chair_simple'
  | 'bed_frame'
  | 'shelf_block'
  | 'machine_box'
  | 'stove_block'
  | 'sink_basin'
  | 'toilet_bowl'
  | 'apparatus_cage'
  | 'lamp_stand'
  | 'candle_stub'
  | 'ceiling_pipe_bundle'
  | 'ceiling_cable_bundle'
  | 'container_crate'
  | 'container_small_box'
  | 'container_tall_cabinet'
  | 'trash_bin'
  | 'corridor_wall_relief'
  | 'corridor_side_ledge'
  | 'corridor_floor_threshold'
  | 'organic_stalactite'
  | 'organic_wall_bulge'
  | 'cave_stalactite'
  | 'cave_wall_protrusion'
  | 'meat_wall_fold'
  | 'meat_floor_fold'
  | 'collector_gutter'
  | 'billboard_prop'
  | 'organic_meat_lump'
  | 'organic_bone_shard'
  | 'organic_pustule'
  | 'organic_rib_cage';

export type VisualModelAnchor = 'center' | 'wall' | 'corner' | 'ceiling' | 'floor' | 'volume';
export type VisualModelAxis = 'x' | 'y' | 'z';
export type VisualModelPlaneOrientation = 'xy' | 'xz' | 'yz';
export type MeshVec2 = readonly [number, number];
export type MeshVec3 = readonly [number, number, number];
export type MeshColor = readonly [number, number, number];

interface VisualModelPartBase {
  material: MeshMaterialId;
  color?: MeshColor;
}

export interface VisualModelBoxPart extends VisualModelPartBase {
  kind: 'box';
  position: MeshVec3;
  size: MeshVec3;
  bevel?: number;
}

export interface VisualModelSlabPart extends VisualModelPartBase {
  kind: 'slab';
  position: MeshVec3;
  size: MeshVec3;
  bevel?: number;
}

export interface VisualModelCylinderPart extends VisualModelPartBase {
  kind: 'cylinder';
  position: MeshVec3;
  radius: number;
  height: number;
  axis?: VisualModelAxis;
  segments?: number;
  capped?: boolean;
}

export interface VisualModelPlanePart extends VisualModelPartBase {
  kind: 'plane';
  position: MeshVec3;
  size: MeshVec2;
  orientation: VisualModelPlaneOrientation;
  normal?: 1 | -1;
  doubleSided?: boolean;
  jitter?: number;
}

export interface VisualModelCrossPlanePart extends VisualModelPartBase {
  kind: 'crossPlane';
  position: MeshVec3;
  size: MeshVec2;
}

export interface VisualModelRailPart extends VisualModelPartBase {
  kind: 'rail';
  from: MeshVec3;
  to: MeshVec3;
  width: number;
  segments?: number;
  gap?: number;
}

export type VisualModelPart =
  | VisualModelBoxPart
  | VisualModelSlabPart
  | VisualModelCylinderPart
  | VisualModelPlanePart
  | VisualModelCrossPlanePart
  | VisualModelRailPart;

export interface VisualModelDef {
  id: VisualModelId;
  tags: readonly string[];
  bounds: { x: number; y: number; z: number };
  anchor: VisualModelAnchor;
  parts: readonly VisualModelPart[];
  variantSalt?: number;
  spriteFallback?: string;
}

export const VISUAL_MODELS: readonly VisualModelDef[] = [
  {
    id: 'pipe_wall_small',
    tags: ['pipe', 'wall', 'industrial', 'merged_candidate'],
    bounds: { x: 1.0, y: 0.08, z: 0.08 },
    anchor: 'wall',
    variantSalt: 11,
    parts: [
      { kind: 'cylinder', position: [0, 0.035, 0], radius: 0.028, height: 1.0, axis: 'x', segments: 6, material: 'rust_metal' },
      { kind: 'rail', from: [-0.42, 0.065, 0.055], to: [0.42, 0.065, 0.055], width: 0.018, segments: 3, gap: 0.08, material: 'painted_metal' },
    ],
  },
  {
    id: 'pipe_wall_large',
    tags: ['pipe', 'wall', 'industrial', 'merged_candidate'],
    bounds: { x: 1.0, y: 0.08, z: 0.09 },
    anchor: 'wall',
    variantSalt: 17,
    parts: [
      { kind: 'cylinder', position: [0, 0.034, 0], radius: 0.032, height: 1.0, axis: 'x', segments: 8, material: 'dark_concrete' },
      { kind: 'cylinder', position: [0, 0.038, 0.004], radius: 0.022, height: 1.02, axis: 'x', segments: 8, material: 'rust_metal' },
    ],
  },
  {
    id: 'button_panel',
    tags: ['button', 'wall', 'panel', 'interactive_hint'],
    bounds: { x: 0.24, y: 0.08, z: 0.28 },
    anchor: 'wall',
    variantSalt: 19,
    parts: [
      { kind: 'slab', position: [0, 0.025, 0], size: [0.24, 0.05, 0.28], material: 'painted_metal' },
      { kind: 'box', position: [-0.055, 0.055, 0.025], size: [0.055, 0.035, 0.055], material: 'emissive_lamp', color: [220, 52, 42] },
      { kind: 'box', position: [0.055, 0.055, -0.045], size: [0.055, 0.035, 0.055], material: 'emissive_screen' },
    ],
  },
  {
    id: 'cable_wall_loose',
    tags: ['cable', 'wall', 'industrial', 'merged_candidate'],
    bounds: { x: 1.0, y: 0.04, z: 0.1 },
    anchor: 'wall',
    variantSalt: 23,
    parts: [
      { kind: 'rail', from: [-0.48, 0.02, 0.025], to: [0.48, 0.02, 0.025], width: 0.012, segments: 5, gap: 0.04, material: 'plastic', color: [22, 23, 24] },
      { kind: 'rail', from: [-0.42, 0.024, -0.03], to: [0.42, 0.024, -0.03], width: 0.01, segments: 4, gap: 0.07, material: 'rust_metal' },
    ],
  },
  {
    id: 'ceiling_cable',
    tags: ['ceiling', 'cable', 'industrial', 'merged_candidate'],
    bounds: { x: 1.0, y: 0.12, z: 0.14 },
    anchor: 'ceiling',
    variantSalt: 29,
    parts: [
      { kind: 'rail', from: [-0.48, -0.035, -0.04], to: [0.48, -0.035, -0.04], width: 0.016, segments: 5, gap: 0.04, material: 'plastic', color: [24, 25, 26] },
      { kind: 'rail', from: [-0.44, 0.035, -0.09], to: [0.44, 0.035, -0.09], width: 0.014, segments: 5, gap: 0.05, material: 'rust_metal' },
    ],
  },
  {
    id: 'wall_panel_flat',
    tags: ['panel', 'wall', 'industrial'],
    bounds: { x: 0.28, y: 0.035, z: 0.16 },
    anchor: 'wall',
    variantSalt: 31,
    parts: [
      { kind: 'slab', position: [0, 0.015, 0], size: [0.28, 0.03, 0.16], material: 'painted_metal' },
      { kind: 'rail', from: [-0.1, 0.033, 0.055], to: [0.1, 0.033, 0.055], width: 0.01, segments: 1, material: 'dark_concrete' },
      { kind: 'rail', from: [-0.1, 0.033, -0.055], to: [0.1, 0.033, -0.055], width: 0.01, segments: 1, material: 'dark_concrete' },
    ],
  },
  {
    id: 'wall_panel_screen',
    tags: ['panel', 'wall', 'screen', 'emissive'],
    bounds: { x: 0.3, y: 0.04, z: 0.18 },
    anchor: 'wall',
    variantSalt: 37,
    parts: [
      { kind: 'slab', position: [0, 0.016, 0], size: [0.3, 0.032, 0.18], material: 'dark_concrete' },
      { kind: 'plane', position: [0, 0.034, 0.012], size: [0.22, 0.1], orientation: 'xz', normal: 1, material: 'emissive_screen' },
      { kind: 'box', position: [0.115, 0.038, -0.07], size: [0.032, 0.022, 0.026], material: 'emissive_lamp' },
    ],
  },
  {
    id: 'ceiling_beam',
    tags: ['ceiling', 'beam', 'structural', 'merged_candidate'],
    bounds: { x: 1.0, y: 0.075, z: 0.065 },
    anchor: 'ceiling',
    variantSalt: 41,
    parts: [
      { kind: 'box', position: [0, 0, -0.035], size: [1.0, 0.075, 0.055], material: 'dark_concrete' },
      { kind: 'rail', from: [-0.42, 0.044, -0.074], to: [0.42, 0.044, -0.074], width: 0.014, segments: 2, gap: 0.08, material: 'rust_metal' },
    ],
  },
  {
    id: 'ceiling_bulb',
    tags: ['ceiling', 'lamp', 'light', 'bulb'],
    bounds: { x: 0.28, y: 0.28, z: 0.18 },
    anchor: 'ceiling',
    variantSalt: 43,
    parts: [
      { kind: 'cylinder', position: [0, 0, -0.035], radius: 0.07, height: 0.035, segments: 8, material: 'painted_metal' },
      { kind: 'cylinder', position: [0, 0, -0.105], radius: 0.10, height: 0.08, segments: 10, material: 'emissive_lamp' },
      { kind: 'crossPlane', position: [0, 0, -0.105], size: [0.24, 0.12], material: 'emissive_lamp' },
    ],
  },
  {
    id: 'ceiling_light_panel',
    tags: ['ceiling', 'lamp', 'light', 'panel'],
    bounds: { x: 0.42, y: 0.22, z: 0.055 },
    anchor: 'ceiling',
    variantSalt: 45,
    parts: [
      { kind: 'slab', position: [0, 0, -0.026], size: [0.42, 0.22, 0.028], material: 'painted_metal' },
      { kind: 'plane', position: [0, 0, -0.042], size: [0.32, 0.15], orientation: 'xy', normal: -1, material: 'emissive_lamp' },
    ],
  },
  {
    id: 'organic_ceiling_tendrils',
    tags: ['ceiling', 'organic', 'meat', 'samosbor'],
    bounds: { x: 0.6, y: 0.6, z: 0.3 },
    anchor: 'ceiling',
    variantSalt: 313,
    parts: [
      { kind: 'cylinder', position: [0, 0, -0.15], radius: 0.06, height: 0.3, axis: 'z', segments: 6, material: 'meat' },
      { kind: 'cylinder', position: [0.1, 0.1, -0.2], radius: 0.04, height: 0.4, axis: 'z', segments: 5, material: 'meat' },
      { kind: 'cylinder', position: [-0.1, -0.05, -0.18], radius: 0.03, height: 0.35, axis: 'z', segments: 5, material: 'meat' },
    ],
  },
  {
    id: 'meat_ceiling_lamp',
    tags: ['ceiling', 'lamp', 'light', 'meat', 'organic'],
    bounds: { x: 0.34, y: 0.34, z: 0.18 },
    anchor: 'ceiling',
    variantSalt: 46,
    parts: [
      { kind: 'cylinder', position: [0, 0, -0.035], radius: 0.16, height: 0.045, segments: 10, material: 'cloth', color: [104, 34, 38] },
      { kind: 'cylinder', position: [0.018, -0.012, -0.086], radius: 0.095, height: 0.065, segments: 10, material: 'cloth', color: [142, 46, 42] },
      { kind: 'cylinder', position: [0.018, -0.012, -0.122], radius: 0.058, height: 0.038, segments: 8, material: 'emissive_lamp', color: [255, 96, 40] },
      { kind: 'crossPlane', position: [0.018, -0.012, -0.126], size: [0.22, 0.1], material: 'emissive_lamp', color: [255, 126, 58] },
      { kind: 'rail', from: [-0.12, 0.1, -0.04], to: [0.12, -0.08, -0.102], width: 0.01, segments: 3, gap: 0.025, material: 'cloth', color: [154, 54, 48] },
    ],
  },
  {
    id: 'chandelier_ornate',
    tags: ['ceiling', 'lamp', 'light', 'chandelier', 'ministry'],
    bounds: { x: 0.6, y: 0.6, z: 0.65 },
    anchor: 'ceiling',
    variantSalt: 314,
    parts: [
      { kind: 'cylinder', position: [0, 0, -0.05], radius: 0.08, height: 0.1, segments: 12, material: 'rust_metal' },
      { kind: 'cylinder', position: [0, 0, -0.3], radius: 0.02, height: 0.4, segments: 8, material: 'rust_metal' },
      { kind: 'cylinder', position: [0, 0, -0.5], radius: 0.4, height: 0.04, segments: 16, material: 'rust_metal' },
      { kind: 'box', position: [0.3, 0, -0.45], size: [0.16, 0.16, 0.16], material: 'emissive_lamp', color: [255, 230, 200] },
      { kind: 'box', position: [-0.3, 0, -0.45], size: [0.16, 0.16, 0.16], material: 'emissive_lamp', color: [255, 230, 200] },
      { kind: 'box', position: [0, 0.3, -0.45], size: [0.16, 0.16, 0.16], material: 'emissive_lamp', color: [255, 230, 200] },
      { kind: 'box', position: [0, -0.3, -0.45], size: [0.16, 0.16, 0.16], material: 'emissive_lamp', color: [255, 230, 200] },
      { kind: 'cylinder', position: [0, 0, -0.58], radius: 0.1, height: 0.1, segments: 8, material: 'rust_metal' },
    ],
  },
  {
    id: 'column_hint',
    tags: ['column', 'concrete', 'structural', 'volume'],
    bounds: { x: 0.7, y: 0.7, z: 1.0 },
    anchor: 'volume',
    variantSalt: 47,
    parts: [
      { kind: 'box', position: [0, 0, 0.05], size: [0.7, 0.7, 0.1], material: 'dark_concrete' },
      { kind: 'box', position: [0, 0, 0.5], size: [0.4, 0.4, 0.82], material: 'concrete' },
      { kind: 'box', position: [0, 0, 0.95], size: [0.62, 0.62, 0.1], material: 'dark_concrete' },
    ],
  },
  {
    id: 'furniture_table_hint',
    tags: ['furniture', 'table', 'floor'],
    bounds: { x: 0.72, y: 0.56, z: 0.58 },
    anchor: 'floor',
    variantSalt: 53,
    parts: [
      { kind: 'slab', position: [0, 0, 0.54], size: [0.72, 0.56, 0.08], material: 'wood' },
      { kind: 'box', position: [-0.27, -0.2, 0.27], size: [0.055, 0.055, 0.48], material: 'painted_metal' },
      { kind: 'box', position: [0.27, -0.2, 0.27], size: [0.055, 0.055, 0.48], material: 'painted_metal' },
      { kind: 'box', position: [-0.27, 0.2, 0.27], size: [0.055, 0.055, 0.48], material: 'painted_metal' },
      { kind: 'box', position: [0.27, 0.2, 0.27], size: [0.055, 0.055, 0.48], material: 'painted_metal' },
    ],
  },
  {
    id: 'furniture_shelf_hint',
    tags: ['furniture', 'shelf', 'storage', 'wall'],
    bounds: { x: 0.64, y: 0.28, z: 0.72 },
    anchor: 'wall',
    variantSalt: 59,
    parts: [
      { kind: 'box', position: [-0.3, 0.12, 0], size: [0.05, 0.24, 0.72], material: 'wood' },
      { kind: 'box', position: [0.3, 0.12, 0], size: [0.05, 0.24, 0.72], material: 'wood' },
      { kind: 'slab', position: [0, 0.12, -0.26], size: [0.64, 0.24, 0.045], material: 'wood' },
      { kind: 'slab', position: [0, 0.12, 0], size: [0.64, 0.24, 0.045], material: 'wood' },
      { kind: 'slab', position: [0, 0.12, 0.26], size: [0.64, 0.24, 0.045], material: 'wood' },
      { kind: 'slab', position: [0, 0.02, 0], size: [0.64, 0.04, 0.72], material: 'dark_concrete' },
    ],
  },
  {
    id: 'machine_panel',
    tags: ['machine', 'panel', 'wall', 'industrial'],
    bounds: { x: 0.62, y: 0.1, z: 0.48 },
    anchor: 'wall',
    variantSalt: 61,
    parts: [
      { kind: 'slab', position: [0, 0.03, 0], size: [0.62, 0.06, 0.48], material: 'painted_metal' },
      { kind: 'plane', position: [-0.1, 0.065, 0.08], size: [0.34, 0.2], orientation: 'xz', normal: 1, material: 'emissive_screen' },
      { kind: 'box', position: [0.23, 0.07, -0.08], size: [0.08, 0.04, 0.08], material: 'emissive_lamp', color: [210, 64, 44] },
      { kind: 'box', position: [0.23, 0.07, 0.08], size: [0.08, 0.04, 0.08], material: 'emissive_screen' },
    ],
  },
  {
    id: 'apparatus_frame',
    tags: ['machine', 'apparatus', 'lab', 'floor'],
    bounds: { x: 0.62, y: 0.62, z: 0.84 },
    anchor: 'floor',
    variantSalt: 67,
    parts: [
      { kind: 'slab', position: [0, 0, 0.08], size: [0.62, 0.62, 0.08], material: 'dark_concrete' },
      { kind: 'rail', from: [-0.25, -0.25, 0.12], to: [-0.25, -0.25, 0.78], width: 0.03, segments: 1, material: 'rust_metal' },
      { kind: 'rail', from: [0.25, -0.25, 0.12], to: [0.25, -0.25, 0.78], width: 0.03, segments: 1, material: 'rust_metal' },
      { kind: 'rail', from: [-0.25, 0.25, 0.12], to: [-0.25, 0.25, 0.78], width: 0.03, segments: 1, material: 'rust_metal' },
      { kind: 'rail', from: [0.25, 0.25, 0.12], to: [0.25, 0.25, 0.78], width: 0.03, segments: 1, material: 'rust_metal' },
      { kind: 'cylinder', position: [0, 0, 0.42], radius: 0.14, height: 0.28, segments: 8, material: 'glass_dim' },
    ],
  },
  {
    id: 'rubble_chunk',
    tags: ['clutter', 'rubble', 'floor'],
    bounds: { x: 0.46, y: 0.42, z: 0.18 },
    anchor: 'floor',
    variantSalt: 71,
    parts: [
      { kind: 'box', position: [-0.12, -0.04, 0.055], size: [0.24, 0.18, 0.11], material: 'concrete' },
      { kind: 'box', position: [0.12, 0.08, 0.04], size: [0.18, 0.16, 0.08], material: 'dark_concrete' },
      { kind: 'box', position: [0.02, -0.16, 0.035], size: [0.12, 0.12, 0.07], material: 'rust_metal' },
    ],
  },
  {
    id: 'floor_tile_shard',
    tags: ['clutter', 'tile', 'shard', 'floor', 'collector'],
    bounds: { x: 0.38, y: 0.28, z: 0.035 },
    anchor: 'floor',
    variantSalt: 72,
    parts: [
      { kind: 'slab', position: [-0.06, -0.02, 0.012], size: [0.22, 0.16, 0.02], material: 'glass_dim', color: [128, 138, 132] },
      { kind: 'slab', position: [0.11, 0.055, 0.016], size: [0.16, 0.095, 0.018], material: 'concrete', color: [92, 96, 92] },
      { kind: 'rail', from: [-0.15, -0.095, 0.028], to: [0.14, 0.085, 0.03], width: 0.006, segments: 3, gap: 0.035, material: 'dark_concrete' },
    ],
  },
  {
    id: 'brick_fragment',
    tags: ['clutter', 'brick', 'fragment', 'floor', 'collector'],
    bounds: { x: 0.34, y: 0.22, z: 0.12 },
    anchor: 'floor',
    variantSalt: 74,
    parts: [
      { kind: 'box', position: [-0.06, -0.015, 0.045], size: [0.22, 0.13, 0.09], material: 'rust_metal', color: [118, 62, 42] },
      { kind: 'box', position: [0.095, 0.045, 0.032], size: [0.12, 0.1, 0.064], material: 'dark_concrete', color: [74, 50, 42] },
      { kind: 'rail', from: [-0.14, 0.06, 0.095], to: [0.12, 0.06, 0.095], width: 0.008, segments: 2, gap: 0.045, material: 'concrete', color: [126, 100, 78] },
    ],
  },
  {
    id: 'collector_floor_pipe',
    tags: ['pipe', 'floor', 'collector', 'clutter'],
    bounds: { x: 0.8, y: 0.11, z: 0.09 },
    anchor: 'floor',
    variantSalt: 76,
    parts: [
      { kind: 'cylinder', position: [0, 0, 0.055], radius: 0.035, height: 0.8, axis: 'x', segments: 8, material: 'rust_metal' },
      { kind: 'cylinder', position: [-0.28, 0, 0.057], radius: 0.045, height: 0.06, axis: 'x', segments: 8, material: 'dark_concrete' },
      { kind: 'cylinder', position: [0.28, 0, 0.057], radius: 0.045, height: 0.06, axis: 'x', segments: 8, material: 'dark_concrete' },
    ],
  },
  {
    id: 'linoleum_peel',
    tags: ['linoleum', 'peel', 'floor', 'residential', 'clutter'],
    bounds: { x: 0.92, y: 0.58, z: 0.035 },
    anchor: 'floor',
    variantSalt: 78,
    parts: [
      { kind: 'plane', position: [0, 0, 0.012], size: [0.86, 0.46], orientation: 'xy', normal: 1, doubleSided: false, material: 'plastic', color: [135, 128, 92], jitter: 0.16 },
    ],
  },
  {
    id: 'linoleum_scrap',
    tags: ['linoleum', 'scrap', 'floor', 'residential', 'clutter'],
    bounds: { x: 0.42, y: 0.28, z: 0.03 },
    anchor: 'floor',
    variantSalt: 80,
    parts: [
      { kind: 'plane', position: [-0.02, 0.02, 0.012], size: [0.4, 0.22], orientation: 'xy', normal: 1, doubleSided: false, material: 'plastic', color: [128, 120, 85], jitter: 0.08 },
    ],
  },
  {
    id: 'paper_sheet',
    tags: ['paper', 'sheet', 'floor', 'clutter'],
    bounds: { x: 0.34, y: 0.24, z: 0.02 },
    anchor: 'floor',
    variantSalt: 82,
    parts: [
      { kind: 'plane', position: [0, 0, 0.011], size: [0.32, 0.22], orientation: 'xy', normal: 1, doubleSided: false, material: 'cloth', color: [174, 174, 156], jitter: 0.04 },
    ],
  },
  {
    id: 'newspaper_sheet',
    tags: ['paper', 'newspaper', 'floor', 'clutter'],
    bounds: { x: 0.46, y: 0.3, z: 0.02 },
    anchor: 'floor',
    variantSalt: 84,
    parts: [
      { kind: 'plane', position: [-0.04, 0.02, 0.011], size: [0.42, 0.3], orientation: 'xy', normal: 1, doubleSided: false, material: 'cloth', color: [142, 142, 128], jitter: 0.05 },
      { kind: 'rail', from: [-0.16, -0.08, 0.018], to: [0.16, -0.08, 0.018], width: 0.004, segments: 4, gap: 0.03, material: 'dark_concrete', color: [66, 68, 62] },
      { kind: 'rail', from: [-0.17, 0.045, 0.018], to: [0.17, 0.045, 0.018], width: 0.004, segments: 5, gap: 0.026, material: 'dark_concrete', color: [72, 74, 68] },
    ],
  },
  {
    id: 'floor_crumb',
    tags: ['crumb', 'floor', 'clutter'],
    bounds: { x: 0.2, y: 0.18, z: 0.045 },
    anchor: 'floor',
    variantSalt: 86,
    parts: [
      { kind: 'slab', position: [-0.04, -0.02, 0.014], size: [0.08, 0.05, 0.028], material: 'dark_concrete', color: [48, 54, 48] },
      { kind: 'slab', position: [0.045, 0.035, 0.011], size: [0.055, 0.045, 0.022], material: 'plastic', color: [52, 88, 58] },
      { kind: 'slab', position: [0.0, 0.07, 0.01], size: [0.04, 0.035, 0.02], material: 'cloth', color: [118, 116, 98] },
    ],
  },
  {
    id: 'organic_thread',
    tags: ['organic', 'thread', 'volume', 'merged_candidate'],
    bounds: { x: 0.88, y: 0.24, z: 0.7 },
    anchor: 'volume',
    variantSalt: 73,
    parts: [
      { kind: 'crossPlane', position: [0, 0, 0.35], size: [0.88, 0.7], material: 'cloth', color: [92, 34, 38] },
      { kind: 'rail', from: [-0.38, 0.08, 0.12], to: [0.38, 0.08, 0.68], width: 0.025, segments: 4, gap: 0.04, material: 'rust_metal' },
    ],
  },
  {
    id: 'column_concrete_square',
    tags: ['concrete', 'column', 'structural', 'volume'],
    bounds: { x: 0.78, y: 0.78, z: 1.0 },
    anchor: 'volume',
    variantSalt: 101,
    parts: [
      { kind: 'box', position: [0, 0, 0.055], size: [0.78, 0.78, 0.11], material: 'dark_concrete' },
      { kind: 'box', position: [0, 0, 0.5], size: [0.46, 0.46, 0.8], material: 'concrete' },
      { kind: 'box', position: [0, 0, 0.955], size: [0.7, 0.7, 0.09], material: 'dark_concrete' },
    ],
  },
  {
    id: 'column_concrete_round',
    tags: ['concrete', 'column', 'structural', 'round', 'volume'],
    bounds: { x: 0.72, y: 0.72, z: 1.0 },
    anchor: 'volume',
    variantSalt: 113,
    parts: [
      { kind: 'cylinder', position: [0, 0, 0.055], radius: 0.36, height: 0.11, segments: 10, material: 'dark_concrete' },
      { kind: 'cylinder', position: [0, 0, 0.5], radius: 0.24, height: 0.82, segments: 10, material: 'concrete' },
      { kind: 'cylinder', position: [0, 0, 0.955], radius: 0.33, height: 0.09, segments: 10, material: 'dark_concrete' },
    ],
  },
  {
    id: 'table_slab',
    tags: ['furniture', 'table', 'residential', 'floor'],
    bounds: { x: 0.82, y: 0.62, z: 0.62 },
    anchor: 'floor',
    spriteFallback: 'feature:table',
    variantSalt: 127,
    parts: [
      { kind: 'slab', position: [0, 0, 0.58], size: [0.82, 0.62, 0.08], material: 'wood' },
      { kind: 'box', position: [-0.32, -0.22, 0.29], size: [0.07, 0.07, 0.5], material: 'dark_concrete' },
      { kind: 'box', position: [0.32, -0.22, 0.29], size: [0.07, 0.07, 0.5], material: 'dark_concrete' },
      { kind: 'box', position: [-0.32, 0.22, 0.29], size: [0.07, 0.07, 0.5], material: 'dark_concrete' },
      { kind: 'box', position: [0.32, 0.22, 0.29], size: [0.07, 0.07, 0.5], material: 'dark_concrete' },
    ],
  },
  {
    id: 'desk_slab',
    tags: ['furniture', 'desk', 'office', 'floor'],
    bounds: { x: 0.9, y: 0.58, z: 0.68 },
    anchor: 'floor',
    spriteFallback: 'feature:desk',
    variantSalt: 129,
    parts: [
      { kind: 'slab', position: [0, 0, 0.62], size: [0.9, 0.58, 0.08], material: 'wood' },
      { kind: 'box', position: [-0.34, -0.18, 0.32], size: [0.09, 0.09, 0.54], material: 'dark_concrete' },
      { kind: 'box', position: [0.34, -0.18, 0.32], size: [0.09, 0.09, 0.54], material: 'dark_concrete' },
      { kind: 'box', position: [-0.28, 0.19, 0.36], size: [0.24, 0.22, 0.42], material: 'wood' },
      { kind: 'box', position: [0.28, 0.19, 0.36], size: [0.24, 0.22, 0.42], material: 'wood' },
      { kind: 'plane', position: [0, -0.305, 0.64], size: [0.42, 0.18], orientation: 'xz', normal: -1, material: 'painted_metal' },
    ],
  },
  {
    id: 'chair_simple',
    tags: ['furniture', 'chair', 'residential', 'floor'],
    bounds: { x: 0.46, y: 0.52, z: 0.78 },
    anchor: 'floor',
    spriteFallback: 'feature:chair',
    variantSalt: 131,
    parts: [
      { kind: 'slab', position: [0, 0, 0.38], size: [0.42, 0.42, 0.08], material: 'wood' },
      { kind: 'box', position: [0, 0.21, 0.62], size: [0.42, 0.08, 0.32], material: 'wood' },
      { kind: 'box', position: [-0.16, -0.14, 0.19], size: [0.05, 0.05, 0.34], material: 'painted_metal' },
      { kind: 'box', position: [0.16, -0.14, 0.19], size: [0.05, 0.05, 0.34], material: 'painted_metal' },
      { kind: 'box', position: [-0.16, 0.14, 0.19], size: [0.05, 0.05, 0.34], material: 'painted_metal' },
      { kind: 'box', position: [0.16, 0.14, 0.19], size: [0.05, 0.05, 0.34], material: 'painted_metal' },
    ],
  },
  {
    id: 'bed_frame',
    tags: ['furniture', 'bed', 'residential', 'floor'],
    bounds: { x: 0.96, y: 0.74, z: 0.46 },
    anchor: 'floor',
    spriteFallback: 'feature:bed',
    variantSalt: 137,
    parts: [
      { kind: 'slab', position: [0, 0, 0.28], size: [0.96, 0.72, 0.12], material: 'cloth', color: [82, 88, 106] },
      { kind: 'box', position: [0, -0.34, 0.35], size: [0.96, 0.08, 0.22], material: 'wood' },
      { kind: 'box', position: [0, 0.34, 0.2], size: [0.96, 0.07, 0.14], material: 'wood' },
      { kind: 'box', position: [-0.42, 0, 0.12], size: [0.07, 0.66, 0.14], material: 'wood' },
      { kind: 'box', position: [0.42, 0, 0.12], size: [0.07, 0.66, 0.14], material: 'wood' },
      { kind: 'slab', position: [-0.28, -0.2, 0.38], size: [0.28, 0.22, 0.08], material: 'cloth', color: [184, 185, 168] },
    ],
  },
  {
    id: 'shelf_block',
    tags: ['furniture', 'shelf', 'storage', 'floor'],
    bounds: { x: 0.62, y: 0.34, z: 0.92 },
    anchor: 'floor',
    spriteFallback: 'feature:shelf',
    variantSalt: 149,
    parts: [
      { kind: 'box', position: [-0.28, 0, 0.46], size: [0.06, 0.34, 0.88], material: 'wood' },
      { kind: 'box', position: [0.28, 0, 0.46], size: [0.06, 0.34, 0.88], material: 'wood' },
      { kind: 'box', position: [0, 0.15, 0.46], size: [0.62, 0.04, 0.88], material: 'dark_concrete' },
      { kind: 'slab', position: [0, 0, 0.14], size: [0.62, 0.32, 0.05], material: 'wood' },
      { kind: 'slab', position: [0, 0, 0.43], size: [0.62, 0.32, 0.05], material: 'wood' },
      { kind: 'slab', position: [0, 0, 0.72], size: [0.62, 0.32, 0.05], material: 'wood' },
      { kind: 'slab', position: [0, 0, 0.9], size: [0.62, 0.32, 0.05], material: 'wood' },
    ],
  },
  {
    id: 'machine_box',
    tags: ['machine', 'industrial', 'lab', 'floor'],
    bounds: { x: 0.78, y: 0.62, z: 0.84 },
    anchor: 'floor',
    spriteFallback: 'feature:machine',
    variantSalt: 157,
    parts: [
      { kind: 'box', position: [0, 0, 0.4], size: [0.78, 0.6, 0.78], material: 'painted_metal' },
      { kind: 'slab', position: [0, -0.315, 0.42], size: [0.54, 0.03, 0.36], material: 'dark_concrete' },
      { kind: 'plane', position: [0, -0.332, 0.48], size: [0.38, 0.22], orientation: 'xz', normal: -1, material: 'emissive_screen' },
      { kind: 'box', position: [-0.28, -0.335, 0.22], size: [0.08, 0.04, 0.08], material: 'rust_metal' },
      { kind: 'box', position: [0.28, -0.335, 0.22], size: [0.08, 0.04, 0.08], material: 'rust_metal' },
    ],
  },
  {
    id: 'stove_block',
    tags: ['machine', 'stove', 'residential', 'floor'],
    bounds: { x: 0.62, y: 0.56, z: 0.72 },
    anchor: 'floor',
    spriteFallback: 'feature:stove',
    variantSalt: 159,
    parts: [
      { kind: 'box', position: [0, 0, 0.34], size: [0.62, 0.54, 0.64], material: 'painted_metal' },
      { kind: 'slab', position: [0, -0.29, 0.5], size: [0.44, 0.035, 0.24], material: 'dark_concrete' },
      { kind: 'cylinder', position: [-0.16, -0.03, 0.69], radius: 0.08, height: 0.025, axis: 'z', segments: 8, material: 'rust_metal' },
      { kind: 'cylinder', position: [0.16, -0.03, 0.69], radius: 0.08, height: 0.025, axis: 'z', segments: 8, material: 'rust_metal' },
    ],
  },
  {
    id: 'sink_basin',
    tags: ['sanitary', 'sink', 'residential', 'floor'],
    bounds: { x: 0.56, y: 0.42, z: 0.62 },
    anchor: 'floor',
    spriteFallback: 'feature:sink',
    variantSalt: 160,
    parts: [
      { kind: 'box', position: [0, 0, 0.28], size: [0.5, 0.34, 0.48], material: 'painted_metal' },
      { kind: 'slab', position: [0, -0.01, 0.56], size: [0.56, 0.42, 0.08], material: 'glass_dim', color: [148, 164, 160] },
      { kind: 'box', position: [0, 0.18, 0.66], size: [0.08, 0.05, 0.14], material: 'rust_metal' },
    ],
  },
  {
    id: 'toilet_bowl',
    tags: ['sanitary', 'toilet', 'residential', 'floor'],
    bounds: { x: 0.48, y: 0.58, z: 0.58 },
    anchor: 'floor',
    spriteFallback: 'feature:toilet',
    variantSalt: 161,
    parts: [
      { kind: 'box', position: [0, 0.18, 0.46], size: [0.42, 0.12, 0.22], material: 'glass_dim', color: [168, 174, 168] },
      { kind: 'cylinder', position: [0, -0.08, 0.28], radius: 0.18, height: 0.18, segments: 10, material: 'glass_dim', color: [174, 180, 174] },
      { kind: 'slab', position: [0, -0.08, 0.42], size: [0.42, 0.36, 0.05], material: 'dark_concrete' },
      { kind: 'box', position: [0, 0.19, 0.18], size: [0.18, 0.12, 0.28], material: 'painted_metal' },
    ],
  },
  {
    id: 'apparatus_cage',
    tags: ['machine', 'apparatus', 'lab', 'industrial', 'floor'],
    bounds: { x: 0.72, y: 0.72, z: 0.92 },
    anchor: 'floor',
    spriteFallback: 'feature:apparatus',
    variantSalt: 163,
    parts: [
      { kind: 'slab', position: [0, 0, 0.08], size: [0.7, 0.7, 0.08], material: 'dark_concrete' },
      { kind: 'rail', from: [-0.3, -0.3, 0.14], to: [-0.3, -0.3, 0.88], width: 0.035, segments: 1, material: 'rust_metal' },
      { kind: 'rail', from: [0.3, -0.3, 0.14], to: [0.3, -0.3, 0.88], width: 0.035, segments: 1, material: 'rust_metal' },
      { kind: 'rail', from: [-0.3, 0.3, 0.14], to: [-0.3, 0.3, 0.88], width: 0.035, segments: 1, material: 'rust_metal' },
      { kind: 'rail', from: [0.3, 0.3, 0.14], to: [0.3, 0.3, 0.88], width: 0.035, segments: 1, material: 'rust_metal' },
      { kind: 'rail', from: [-0.32, 0, 0.74], to: [0.32, 0, 0.74], width: 0.035, segments: 1, material: 'rust_metal' },
      { kind: 'cylinder', position: [0, 0, 0.42], radius: 0.18, height: 0.32, segments: 8, material: 'glass_dim' },
      { kind: 'plane', position: [0, -0.34, 0.54], size: [0.24, 0.16], orientation: 'xz', normal: -1, material: 'emissive_screen' },
    ],
  },
  {
    id: 'lamp_stand',
    tags: ['lamp', 'light', 'floor', 'residential'],
    bounds: { x: 0.32, y: 0.32, z: 0.94 },
    anchor: 'floor',
    spriteFallback: 'feature:lamp',
    variantSalt: 181,
    parts: [
      { kind: 'cylinder', position: [0, 0, 0.08], radius: 0.14, height: 0.05, segments: 8, material: 'painted_metal' },
      { kind: 'cylinder', position: [0, 0, 0.47], radius: 0.025, height: 0.76, segments: 6, material: 'painted_metal' },
      { kind: 'cylinder', position: [0, 0, 0.85], radius: 0.13, height: 0.12, segments: 8, material: 'emissive_lamp' },
      { kind: 'crossPlane', position: [0, 0, 0.84], size: [0.34, 0.18], material: 'emissive_lamp' },
    ],
  },
  {
    id: 'candle_stub',
    tags: ['candle', 'light', 'floor', 'small'],
    bounds: { x: 0.18, y: 0.18, z: 0.26 },
    anchor: 'floor',
    spriteFallback: 'feature:candle',
    variantSalt: 191,
    parts: [
      { kind: 'cylinder', position: [0, 0, 0.09], radius: 0.055, height: 0.18, segments: 8, material: 'cloth', color: [218, 208, 168] },
      { kind: 'crossPlane', position: [0, 0, 0.21], size: [0.09, 0.12], material: 'emissive_lamp' },
    ],
  },
  {
    id: 'ceiling_pipe_bundle',
    tags: ['ceiling', 'pipe', 'industrial', 'merged_candidate'],
    bounds: { x: 1.0, y: 0.16, z: 0.14 },
    anchor: 'ceiling',
    variantSalt: 211,
    parts: [
      { kind: 'cylinder', position: [0, -0.052, -0.05], radius: 0.02, height: 1.0, axis: 'x', segments: 6, material: 'rust_metal' },
      { kind: 'cylinder', position: [0, 0.014, -0.075], radius: 0.018, height: 1.0, axis: 'x', segments: 6, material: 'dark_concrete' },
      { kind: 'rail', from: [-0.42, 0.07, -0.115], to: [0.42, 0.07, -0.115], width: 0.018, segments: 4, gap: 0.04, material: 'painted_metal' },
    ],
  },
  {
    id: 'ceiling_cable_bundle',
    tags: ['ceiling', 'cable', 'industrial', 'merged_candidate'],
    bounds: { x: 1.0, y: 0.12, z: 0.16 },
    anchor: 'ceiling',
    variantSalt: 223,
    parts: [
      { kind: 'rail', from: [-0.48, -0.028, -0.03], to: [0.48, -0.028, -0.03], width: 0.012, segments: 5, gap: 0.035, material: 'dark_concrete' },
      { kind: 'rail', from: [-0.44, 0.028, -0.07], to: [0.44, 0.028, -0.07], width: 0.01, segments: 5, gap: 0.045, material: 'rust_metal' },
      { kind: 'crossPlane', position: [0, 0, -0.105], size: [0.6, 0.06], material: 'plastic', color: [28, 28, 30] },
    ],
  },
  {
    id: 'container_crate',
    tags: ['container', 'crate', 'floor'],
    bounds: { x: 0.58, y: 0.5, z: 0.46 },
    anchor: 'floor',
    variantSalt: 241,
    parts: [
      { kind: 'box', position: [0, 0, 0.23], size: [0.58, 0.5, 0.42], material: 'wood' },
      { kind: 'rail', from: [-0.24, -0.27, 0.34], to: [0.24, -0.27, 0.34], width: 0.035, segments: 2, gap: 0.03, material: 'dark_concrete' },
      { kind: 'rail', from: [-0.24, 0.27, 0.14], to: [0.24, 0.27, 0.14], width: 0.035, segments: 2, gap: 0.03, material: 'dark_concrete' },
    ],
  },
  {
    id: 'container_small_box',
    tags: ['container', 'box', 'floor'],
    bounds: { x: 0.44, y: 0.34, z: 0.28 },
    anchor: 'floor',
    variantSalt: 243,
    parts: [
      { kind: 'box', position: [0, 0, 0.14], size: [0.44, 0.34, 0.26], material: 'painted_metal' },
      { kind: 'slab', position: [0, -0.18, 0.2], size: [0.32, 0.025, 0.08], material: 'dark_concrete' },
      { kind: 'box', position: [0.16, -0.19, 0.12], size: [0.05, 0.035, 0.05], material: 'emissive_lamp' },
    ],
  },
  {
    id: 'container_tall_cabinet',
    tags: ['container', 'cabinet', 'storage', 'floor'],
    bounds: { x: 0.62, y: 0.5, z: 0.96 },
    anchor: 'floor',
    variantSalt: 251,
    parts: [
      { kind: 'box', position: [0, 0, 0.48], size: [0.62, 0.48, 0.92], material: 'painted_metal' },
      { kind: 'slab', position: [0, -0.255, 0.5], size: [0.52, 0.03, 0.78], material: 'dark_concrete' },
      { kind: 'box', position: [-0.09, -0.28, 0.5], size: [0.035, 0.035, 0.22], material: 'rust_metal' },
      { kind: 'box', position: [0.09, -0.28, 0.5], size: [0.035, 0.035, 0.22], material: 'rust_metal' },
    ],
  },
  {
    id: 'trash_bin',
    tags: ['container', 'trash', 'floor'],
    bounds: { x: 0.44, y: 0.44, z: 0.68 },
    anchor: 'floor',
    variantSalt: 257,
    parts: [
      { kind: 'cylinder', position: [0, 0, 0.32], radius: 0.2, height: 0.62, segments: 8, material: 'dark_concrete' },
      { kind: 'cylinder', position: [0, 0, 0.66], radius: 0.22, height: 0.05, segments: 8, material: 'rust_metal' },
      { kind: 'box', position: [0, -0.21, 0.5], size: [0.18, 0.035, 0.16], material: 'painted_metal' },
    ],
  },
  {
    id: 'corridor_wall_relief',
    tags: ['corridor', 'wall', 'relief', 'structural'],
    bounds: { x: 0.28, y: 0.035, z: 0.13 },
    anchor: 'wall',
    variantSalt: 271,
    parts: [
      { kind: 'slab', position: [0, 0.014, 0], size: [0.26, 0.028, 0.105], material: 'dark_concrete' },
      { kind: 'rail', from: [-0.105, 0.031, 0.043], to: [0.105, 0.031, 0.043], width: 0.008, segments: 2, gap: 0.04, material: 'concrete' },
      { kind: 'rail', from: [-0.09, 0.032, -0.04], to: [0.09, 0.032, -0.04], width: 0.007, segments: 2, gap: 0.035, material: 'rust_metal' },
    ],
  },
  {
    id: 'corridor_side_ledge',
    tags: ['corridor', 'wall', 'ledge', 'structural'],
    bounds: { x: 0.34, y: 0.045, z: 0.055 },
    anchor: 'wall',
    variantSalt: 277,
    parts: [
      { kind: 'slab', position: [0, 0.018, 0], size: [0.32, 0.036, 0.038], material: 'dark_concrete' },
      { kind: 'rail', from: [-0.13, 0.038, 0.024], to: [0.13, 0.038, 0.024], width: 0.007, segments: 3, gap: 0.035, material: 'rust_metal' },
    ],
  },
  {
    id: 'corridor_floor_threshold',
    tags: ['corridor', 'floor', 'threshold', 'structural'],
    bounds: { x: 0.38, y: 0.055, z: 0.028 },
    anchor: 'floor',
    variantSalt: 281,
    parts: [
      { kind: 'slab', position: [0, 0, 0.012], size: [0.36, 0.046, 0.024], material: 'dark_concrete' },
      { kind: 'rail', from: [-0.15, 0, 0.029], to: [0.15, 0, 0.029], width: 0.006, segments: 3, gap: 0.03, material: 'painted_metal' },
    ],
  },
  {
    id: 'organic_stalactite',
    tags: ['corridor', 'organic', 'ceiling', 'stalactite'],
    bounds: { x: 0.18, y: 0.18, z: 0.24 },
    anchor: 'ceiling',
    variantSalt: 283,
    parts: [
      { kind: 'cylinder', position: [0, 0, -0.045], radius: 0.052, height: 0.085, segments: 7, material: 'cloth', color: [104, 42, 44] },
      { kind: 'cylinder', position: [0, 0, -0.115], radius: 0.03, height: 0.075, segments: 6, material: 'cloth', color: [126, 48, 50] },
      { kind: 'cylinder', position: [0, 0, -0.175], radius: 0.016, height: 0.05, segments: 5, material: 'rust_metal', color: [118, 50, 45] },
      { kind: 'crossPlane', position: [0, 0, -0.105], size: [0.14, 0.15], material: 'cloth', color: [96, 34, 38] },
    ],
  },
  {
    id: 'organic_wall_bulge',
    tags: ['corridor', 'organic', 'wall', 'bulge'],
    bounds: { x: 0.26, y: 0.06, z: 0.16 },
    anchor: 'wall',
    variantSalt: 287,
    parts: [
      { kind: 'slab', position: [0, 0.018, 0], size: [0.22, 0.036, 0.11], material: 'cloth', color: [92, 34, 38] },
      { kind: 'cylinder', position: [-0.07, 0.04, 0.025], radius: 0.026, height: 0.045, axis: 'y', segments: 6, material: 'cloth', color: [128, 48, 46] },
      { kind: 'cylinder', position: [0.075, 0.04, -0.035], radius: 0.023, height: 0.05, axis: 'y', segments: 6, material: 'cloth', color: [118, 42, 44] },
      { kind: 'rail', from: [-0.105, 0.052, -0.052], to: [0.105, 0.052, 0.048], width: 0.007, segments: 3, gap: 0.03, material: 'rust_metal' },
    ],
  },
  {
    id: 'cave_stalactite',
    tags: ['corridor', 'cave', 'ceiling', 'stalactite'],
    bounds: { x: 0.18, y: 0.18, z: 0.26 },
    anchor: 'ceiling',
    variantSalt: 289,
    parts: [
      { kind: 'cylinder', position: [0, 0, -0.045], radius: 0.052, height: 0.085, segments: 7, material: 'dark_concrete', color: [92, 90, 82] },
      { kind: 'cylinder', position: [0.012, -0.008, -0.12], radius: 0.032, height: 0.095, segments: 6, material: 'concrete', color: [108, 104, 94] },
      { kind: 'cylinder', position: [-0.006, 0.008, -0.185], radius: 0.018, height: 0.06, segments: 5, material: 'dark_concrete', color: [76, 74, 68] },
      { kind: 'crossPlane', position: [0, 0, -0.085], size: [0.13, 0.12], material: 'dark_concrete', color: [82, 80, 74] },
    ],
  },
  {
    id: 'cave_wall_protrusion',
    tags: ['corridor', 'cave', 'wall', 'protrusion'],
    bounds: { x: 0.26, y: 0.065, z: 0.16 },
    anchor: 'wall',
    variantSalt: 293,
    parts: [
      { kind: 'slab', position: [0, 0.02, 0], size: [0.22, 0.04, 0.11], material: 'dark_concrete', color: [80, 78, 70] },
      { kind: 'cylinder', position: [-0.07, 0.043, 0.032], radius: 0.03, height: 0.046, axis: 'y', segments: 6, material: 'concrete', color: [108, 104, 94] },
      { kind: 'cylinder', position: [0.064, 0.043, -0.04], radius: 0.026, height: 0.046, axis: 'y', segments: 6, material: 'dark_concrete', color: [72, 70, 64] },
      { kind: 'slab', position: [0.008, 0.05, -0.006], size: [0.12, 0.018, 0.065], material: 'concrete', color: [96, 92, 84] },
    ],
  },
  {
    id: 'meat_wall_fold',
    tags: ['corridor', 'meat', 'organic', 'wall', 'fold'],
    bounds: { x: 0.28, y: 0.07, z: 0.16 },
    anchor: 'wall',
    variantSalt: 297,
    parts: [
      { kind: 'slab', position: [0, 0.02, 0], size: [0.24, 0.04, 0.105], material: 'cloth', color: [102, 38, 42] },
      { kind: 'cylinder', position: [-0.072, 0.043, 0.024], radius: 0.026, height: 0.13, axis: 'x', segments: 7, material: 'cloth', color: [134, 50, 50] },
      { kind: 'cylinder', position: [0.065, 0.043, -0.032], radius: 0.022, height: 0.105, axis: 'x', segments: 7, material: 'cloth', color: [118, 42, 46] },
      { kind: 'slab', position: [0.008, 0.052, -0.006], size: [0.16, 0.012, 0.028], material: 'cloth', color: [150, 62, 56] },
    ],
  },
  {
    id: 'meat_floor_fold',
    tags: ['corridor', 'meat', 'organic', 'floor', 'fold'],
    bounds: { x: 0.32, y: 0.12, z: 0.07 },
    anchor: 'floor',
    variantSalt: 299,
    parts: [
      { kind: 'slab', position: [0, 0.018, 0.022], size: [0.28, 0.07, 0.044], material: 'cloth', color: [88, 26, 34] },
      { kind: 'cylinder', position: [-0.075, 0.042, 0.054], radius: 0.021, height: 0.16, axis: 'x', segments: 7, material: 'cloth', color: [132, 44, 48] },
      { kind: 'cylinder', position: [0.082, 0.034, 0.045], radius: 0.017, height: 0.13, axis: 'x', segments: 6, material: 'cloth', color: [112, 36, 42] },
      { kind: 'rail', from: [-0.12, 0.075, 0.04], to: [0.115, 0.075, 0.052], width: 0.006, segments: 3, gap: 0.03, material: 'rust_metal', color: [116, 46, 42] },
    ],
  },
  {
    id: 'collector_gutter',
    tags: ['corridor', 'collector', 'floor', 'gutter'],
    bounds: { x: 0.42, y: 0.09, z: 0.04 },
    anchor: 'floor',
    variantSalt: 301,
    parts: [
      { kind: 'slab', position: [0, 0, 0.012], size: [0.4, 0.07, 0.024], material: 'dark_concrete', color: [44, 48, 46] },
      { kind: 'slab', position: [0, -0.028, 0.033], size: [0.4, 0.012, 0.026], material: 'rust_metal', color: [82, 58, 42] },
      { kind: 'slab', position: [0, 0.028, 0.033], size: [0.4, 0.012, 0.026], material: 'rust_metal', color: [82, 58, 42] },
      { kind: 'rail', from: [-0.17, 0, 0.045], to: [0.17, 0, 0.045], width: 0.006, segments: 4, gap: 0.03, material: 'painted_metal' },
    ],
  },
  {
    id: 'billboard_prop',
    tags: ['billboard', 'fallback', 'floor'],
    bounds: { x: 0.62, y: 0.16, z: 0.82 },
    anchor: 'floor',
    variantSalt: 263,
    parts: [
      { kind: 'crossPlane', position: [0, 0, 0.42], size: [0.62, 0.82], material: 'cloth', color: [118, 112, 96] },
      { kind: 'slab', position: [0, 0, 0.04], size: [0.52, 0.18, 0.08], material: 'dark_concrete' },
    ],
  },
  {
    id: 'organic_meat_lump',
    tags: ['organic', 'meat', 'floor', 'clutter'],
    bounds: { x: 0.2, y: 0.2, z: 0.15 },
    anchor: 'floor',
    variantSalt: 311,
    parts: [
      { kind: 'box', position: [0, 0, 0.04], size: [0.16, 0.12, 0.08], material: 'cloth', color: [112, 32, 36] },
    ],
  },
  {
    id: 'organic_bone_shard',
    tags: ['organic', 'bone', 'floor', 'clutter'],
    bounds: { x: 0.24, y: 0.2, z: 0.28 },
    anchor: 'floor',
    variantSalt: 313,
    parts: [
      { kind: 'box', position: [0, 0, 0.14], size: [0.08, 0.06, 0.28], material: 'plastic', color: [180, 175, 150] },
      { kind: 'slab', position: [0, 0, 0.04], size: [0.18, 0.14, 0.08], material: 'cloth', color: [112, 36, 42] },
    ],
  },
  {
    id: 'organic_pustule',
    tags: ['organic', 'pustule', 'floor', 'clutter'],
    bounds: { x: 0.22, y: 0.22, z: 0.16 },
    anchor: 'floor',
    variantSalt: 317,
    parts: [
      { kind: 'cylinder', position: [0, 0, 0.04], radius: 0.11, height: 0.08, segments: 8, material: 'cloth', color: [92, 22, 28] },
      { kind: 'cylinder', position: [0, 0, 0.1], radius: 0.08, height: 0.06, segments: 8, material: 'glass_dim', color: [210, 180, 60] },
    ],
  },
  {
    id: 'organic_rib_cage',
    tags: ['organic', 'bone', 'rib', 'floor', 'clutter'],
    bounds: { x: 0.46, y: 0.36, z: 0.22 },
    anchor: 'floor',
    variantSalt: 319,
    parts: [
      { kind: 'slab', position: [0, 0, 0.02], size: [0.42, 0.28, 0.04], material: 'cloth', color: [92, 22, 28] },
      { kind: 'cylinder', position: [0, 0, 0.08], radius: 0.04, height: 0.46, axis: 'x', segments: 6, material: 'plastic', color: [160, 155, 135] },
      { kind: 'cylinder', position: [-0.12, 0, 0.11], radius: 0.025, height: 0.32, axis: 'y', segments: 5, material: 'plastic', color: [170, 165, 145] },
      { kind: 'cylinder', position: [0, 0, 0.12], radius: 0.025, height: 0.36, axis: 'y', segments: 5, material: 'plastic', color: [170, 165, 145] },
      { kind: 'cylinder', position: [0.12, 0, 0.11], radius: 0.025, height: 0.32, axis: 'y', segments: 5, material: 'plastic', color: [170, 165, 145] },
    ],
  },
  {
    id: 'organic_wall_veins',
    tags: ['wall', 'organic', 'giger', 'meat', 'samosbor'],
    bounds: { x: 0.12, y: 1.0, z: 1.0 },
    anchor: 'wall',
    variantSalt: 311,
    parts: [
      { kind: 'cylinder', position: [0.03, -0.2, 0.4], radius: 0.04, height: 1.2, axis: 'y', segments: 6, material: 'meat' },
      { kind: 'cylinder', position: [0.04, 0.15, 0.6], radius: 0.035, height: 1.1, axis: 'y', segments: 6, material: 'meat' },
      { kind: 'cylinder', position: [0.02, 0.0, 0.2], radius: 0.05, height: 1.3, axis: 'y', segments: 6, material: 'meat' },
    ],
  },
  {
    id: 'organic_wall_ribs',
    tags: ['wall', 'organic', 'bone', 'scorn', 'samosbor'],
    bounds: { x: 0.2, y: 1.0, z: 1.0 },
    anchor: 'wall',
    variantSalt: 312,
    parts: [
      { kind: 'slab', position: [0.06, 0, 0.2], size: [0.12, 0.8, 0.08], material: 'bone' },
      { kind: 'slab', position: [0.06, 0, 0.5], size: [0.12, 0.8, 0.08], material: 'bone' },
      { kind: 'slab', position: [0.06, 0, 0.8], size: [0.12, 0.8, 0.08], material: 'bone' },
      { kind: 'slab', position: [0.02, -0.3, 0.5], size: [0.06, 0.1, 0.9], material: 'meat' },
      { kind: 'slab', position: [0.02, 0.3, 0.5], size: [0.06, 0.1, 0.9], material: 'meat' },
    ],
  },
  {
    id: 'organic_column_bone',
    tags: ['column', 'organic', 'bone', 'scorn', 'samosbor', 'floor'],
    bounds: { x: 0.5, y: 0.5, z: 1.0 },
    anchor: 'floor',
    variantSalt: 314,
    parts: [
      { kind: 'cylinder', position: [0, 0, 0.5], radius: 0.18, height: 1.0, axis: 'z', segments: 8, material: 'bone' },
      { kind: 'cylinder', position: [0, 0, 0.1], radius: 0.24, height: 0.2, axis: 'z', segments: 8, material: 'meat' },
      { kind: 'cylinder', position: [0, 0, 0.9], radius: 0.24, height: 0.2, axis: 'z', segments: 8, material: 'meat' },
      { kind: 'box', position: [0.12, 0.12, 0.5], size: [0.08, 0.08, 0.8], material: 'meat' },
      { kind: 'box', position: [-0.12, -0.12, 0.5], size: [0.08, 0.08, 0.8], material: 'meat' },
    ],
  },
] as const;

export const ALL_VISUAL_MODEL_IDS: readonly VisualModelId[] = VISUAL_MODELS.map(model => model.id);

const VISUAL_MODEL_BY_ID = new Map<VisualModelId, VisualModelDef>(
  VISUAL_MODELS.map(model => [model.id, model]),
);

export function visualModelDef(id: VisualModelId): VisualModelDef {
  const def = VISUAL_MODEL_BY_ID.get(id);
  if (!def) throw new Error(`[VISUAL_MODEL] unknown model id "${id}"`);
  return def;
}

export function maybeVisualModelDef(id: string): VisualModelDef | undefined {
  return VISUAL_MODEL_BY_ID.get(id as VisualModelId);
}
