import Phaser from "phaser";
import {
  createDefaultWorld,
  getActiveProfile,
  getActiveWorld,
  saveActiveCharacter,
} from "@game/save";

const MAP_KEY = "mapOne";
const MAP_JSON_PATH = "assets/mapOne/MapOne.json";
const TILESET_KEY = "Tile_Atlas";
const TILESET_IMAGE_PATH = "assets/mapOne/tiles/Tile_Atlas.png";

const LAYERS_BELOW_PLAYER = [
  "Ocean",
  "Grass",
  "Dirt",
  "Road",
  "CityFloor",
  "SummonPlatforms",
  "Water",
];

const COLLISION_LAYER_NAMES = [
  "Walls",
  "Props",
  "TreeBottoms",
  "Shops",
  "HouseBottoms",
  "WaterEdge",
  "GrassEdge",
];

const GROUND_LAYER_DEPTH = 400;
const PLAYER_DEPTH = 500;
const SHOPS_LAYER_DEPTH = 900;
const TOP_LAYER_DEPTHS: Record<string, number> = {
  TreeTops: 1000,
  HouseTops: 1001,
};
const COLLISION_LAYER_DEPTH_OVERRIDES: Partial<Record<string, number>> = {
  Shops: SHOPS_LAYER_DEPTH,
};

const PLAYER_TEXTURE_KEY = "overworld-player";
const KNIGHT_STILL_KEY = "knight-still";
const KNIGHT_WALK_NORTH_KEY = "knight-walk-north";
const KNIGHT_WALK_SOUTH_KEY = "knight-walk-south";
const KNIGHT_WALK_EAST_KEY = "knight-walk-east";
const KNIGHT_WALK_WEST_KEY = "knight-walk-west";
const KNIGHT_WALK_NORTH_EAST_KEY = "knight-walk-north-east";
const KNIGHT_WALK_NORTH_WEST_KEY = "knight-walk-north-west";
const KNIGHT_WALK_SOUTH_EAST_KEY = "knight-walk-south-east";
const KNIGHT_WALK_SOUTH_WEST_KEY = "knight-walk-south-west";
const SLIME_STILL_KEY = "slime-still";
const SLIME_SLIDE_NORTH_KEY = "slime-slide-north";
const SLIME_SLIDE_SOUTH_KEY = "slime-slide-south";
const SLIME_SLIDE_EAST_KEY = "slime-slide-east";
const SLIME_SLIDE_WEST_KEY = "slime-slide-west";
const SLIME_SLIDE_NORTH_EAST_KEY = "slime-slide-north-east";
const SLIME_SLIDE_NORTH_WEST_KEY = "slime-slide-north-west";
const SLIME_SLIDE_SOUTH_EAST_KEY = "slime-slide-south-east";
const SLIME_SLIDE_SOUTH_WEST_KEY = "slime-slide-south-west";
const KNIGHT_ANIM_WALK_NORTH = "knight-walk-cycle-north";
const KNIGHT_ANIM_WALK_SOUTH = "knight-walk-cycle-south";
const KNIGHT_ANIM_WALK_EAST = "knight-walk-cycle-east";
const KNIGHT_ANIM_WALK_WEST = "knight-walk-cycle-west";
const KNIGHT_ANIM_WALK_NORTH_EAST = "knight-walk-cycle-north-east";
const KNIGHT_ANIM_WALK_NORTH_WEST = "knight-walk-cycle-north-west";
const KNIGHT_ANIM_WALK_SOUTH_EAST = "knight-walk-cycle-south-east";
const KNIGHT_ANIM_WALK_SOUTH_WEST = "knight-walk-cycle-south-west";
const SLIME_ANIM_IDLE = "slime-idle";
const SLIME_ANIM_SLIDE_NORTH = "slime-slide-cycle-north";
const SLIME_ANIM_SLIDE_SOUTH = "slime-slide-cycle-south";
const SLIME_ANIM_SLIDE_EAST = "slime-slide-cycle-east";
const SLIME_ANIM_SLIDE_WEST = "slime-slide-cycle-west";
const SLIME_ANIM_SLIDE_NORTH_EAST = "slime-slide-cycle-north-east";
const SLIME_ANIM_SLIDE_NORTH_WEST = "slime-slide-cycle-north-west";
const SLIME_ANIM_SLIDE_SOUTH_EAST = "slime-slide-cycle-south-east";
const SLIME_ANIM_SLIDE_SOUTH_WEST = "slime-slide-cycle-south-west";
const PLAYER_SPEED = 2;
const CAMERA_ZOOM = 2;

const MINIMAP_MAX_SIZE = 400;
const MINIMAP_MIN_SIZE = 300;
const MINIMAP_MARGIN = 16;
const MINIMAP_FRAME_PADDING = 12;
const MINIMAP_BACKGROUND_COLOR = 0x050608;
const MINIMAP_BACKGROUND_ALPHA = 0.6;
const MINIMAP_OUTLINE_COLOR = 0xffffff;
const MINIMAP_OUTLINE_ALPHA = 0.45;
const MINIMAP_INDICATOR_RADIUS = 100;
const MINIMAP_INDICATOR_COLOR = 0xFFBF00;
const MINIMAP_CITY_MARKER_DEPTH = 1500;
const MINIMAP_PLAYER_INDICATOR_DEPTH = MINIMAP_CITY_MARKER_DEPTH + 10;

type EncounterKind = "common" | "wraith" | "ogre";

type KnightFacing =
  | "north"
  | "south"
  | "east"
  | "west"
  | "northEast"
  | "northWest"
  | "southEast"
  | "southWest";

type SlimeFacing = KnightFacing;

interface EncounterConfig {
  textureKey: string;
  label: string;
  fill: number;
  stroke: number;
  radius: number;
  enemyId: string;
  enemyLevel: number;
}

interface SpawnZone {
  id: string;
  kind: EncounterKind;
  polygon: Phaser.Geom.Polygon;
}

interface SpawnZoneInstance {
  zone: SpawnZone;
  sensor: Phaser.Physics.Matter.Sprite;
  display: Phaser.GameObjects.Sprite;
  wanderTarget?: Phaser.Math.Vector2;
  wanderTween?: Phaser.Tweens.Tween;
  wanderTimer?: Phaser.Time.TimerEvent;
  facing?: SlimeFacing;
}

const ENCOUNTER_LAYER_MAP: Record<string, EncounterKind> = {
  EnemySpawns: "common",
  WraithSpawn: "wraith",
  OgreSpawn: "ogre",
};

const ENCOUNTER_CONFIGS: Record<EncounterKind, EncounterConfig> = {
  common: {
    textureKey: "encounter-common",
    label: "encounter-common",
    fill: 0x9b59b6,
    stroke: 0xffffff,
    radius: 12,
    enemyId: "slime",
    enemyLevel: 1,
  },
  wraith: {
    textureKey: "encounter-wraith",
    label: "encounter-wraith",
    fill: 0x16a085,
    stroke: 0xffffff,
    radius: 14,
    enemyId: "wraith",
    enemyLevel: 8,
  },
  ogre: {
    textureKey: "encounter-ogre",
    label: "encounter-ogre",
    fill: 0xe67e22,
    stroke: 0xffffff,
    radius: 16,
    enemyId: "ogre",
    enemyLevel: 12,
  },
};

const ENCOUNTER_DEPTH = PLAYER_DEPTH - 5;
const ENCOUNTER_WANDER_SPEED = 24;
const ENCOUNTER_WANDER_MIN_DELAY = 400;
const ENCOUNTER_WANDER_MAX_DELAY = 1400;
const ENCOUNTER_WANDER_MIN_DURATION = 250;

type WASDKeys = Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;

type MinimapViewport = { x: number; y: number; width: number; height: number; zoom: number };

const OVERWORLD_EVENT_ACTIVE = "overworld:active";
const OVERWORLD_EVENT_PAUSE_CHANGED = "overworld:pause-changed";
const OVERWORLD_EVENT_RESUME_REQUEST = "overworld:resume-request";
const OVERWORLD_EVENT_SAVE_REQUEST = "overworld:save-request";
const OVERWORLD_EVENT_SAVE_COMPLETE = "overworld:save-complete";

interface OverworldInitData {
  summary?: string[];
  outcome?: "victory" | "defeat" | "fled";
  position?: { x: number; y: number };
}

export class Overworld extends Phaser.Scene {
  private map?: Phaser.Tilemaps.Tilemap;
  private layers = new Map<string, Phaser.Tilemaps.TilemapLayer>();
  private player?: Phaser.Physics.Matter.Sprite;
  private keys?: WASDKeys;
  private minimapCamera?: Phaser.Cameras.Scene2D.Camera;
  private minimapBackdrop?: Phaser.GameObjects.Rectangle;
  private minimapMarker?: Phaser.GameObjects.Arc;
  private minimapCityMarkers: Phaser.GameObjects.GameObject[] = [];
  private minimapViewport?: MinimapViewport;
  private spawnZones: SpawnZone[] = [];
  private spawnZoneInstances = new Map<string, SpawnZoneInstance>();
  private spawnZoneBodies = new Map<MatterJS.BodyType, SpawnZone>();
  private encounterActive = false;
  private matterCollisionAttached = false;
  private initData?: OverworldInitData;
  private pauseKey?: Phaser.Input.Keyboard.Key;
  private isPaused = false;
  private isKnightPlayer = false;
  private playerFacing: KnightFacing = "south";

  constructor() {
    super("Overworld");
  }

  init(data: OverworldInitData = {}) {
    this.initData = data;
  }

  preload() {
    this.load.tilemapTiledJSON(MAP_KEY, MAP_JSON_PATH);
    this.load.image(TILESET_KEY, TILESET_IMAGE_PATH);
    this.load.spritesheet(KNIGHT_STILL_KEY, "assets/Characters/Knight/Knight_Still.png", {
      frameWidth: 64,
      frameHeight: 64,
    });
    this.load.spritesheet(
      KNIGHT_WALK_NORTH_KEY,
      "assets/Characters/Knight/Animations/Walk/Walk_Back.png",
      {
        frameWidth: 64,
        frameHeight: 64,
        endFrame: 3,
      },
    );
    this.load.spritesheet(
      KNIGHT_WALK_SOUTH_KEY,
      "assets/Characters/Knight/Animations/Walk/Walk_Front.png",
      {
        frameWidth: 64,
        frameHeight: 64,
        endFrame: 3,
      },
    );
    this.load.spritesheet(
      KNIGHT_WALK_NORTH_EAST_KEY,
      "assets/Characters/Knight/Animations/Walk/Walk_BackRight.png",
      {
        frameWidth: 64,
        frameHeight: 64,
        endFrame: 3,
      },
    );
    this.load.spritesheet(
      KNIGHT_WALK_NORTH_WEST_KEY,
      "assets/Characters/Knight/Animations/Walk/Walk_BackLeft.png",
      {
        frameWidth: 64,
        frameHeight: 64,
        endFrame: 3,
      },
    );
    this.load.spritesheet(
      KNIGHT_WALK_WEST_KEY,
      "assets/Characters/Knight/Animations/Walk/Walk_Left.png",
      {
        frameWidth: 64,
        frameHeight: 64,
        endFrame: 3,
      },
    );
    this.load.spritesheet(
      KNIGHT_WALK_EAST_KEY,
      "assets/Characters/Knight/Animations/Walk/Walk_Right.png",
      {
        frameWidth: 64,
        frameHeight: 64,
        endFrame: 3,
      },
    );
    this.load.spritesheet(
      KNIGHT_WALK_SOUTH_EAST_KEY,
      "assets/Characters/Knight/Animations/Walk/Walk_FrontRight.png",
      {
        frameWidth: 64,
        frameHeight: 64,
        endFrame: 3,
      },
    );
    this.load.spritesheet(
      KNIGHT_WALK_SOUTH_WEST_KEY,
      "assets/Characters/Knight/Animations/Walk/Walk_FrontLeft.png",
      {
        frameWidth: 64,
        frameHeight: 64,
        endFrame: 3,
      },
    );

    this.load.image(SLIME_STILL_KEY, "assets/Characters/Slime/Slime_Still.png");

    const slimeSheets: Array<{ key: string; path: string }> = [
      { key: SLIME_SLIDE_NORTH_KEY, path: "assets/Characters/Slime/Animations/Slide/Slide_Back.png" },
      { key: SLIME_SLIDE_SOUTH_KEY, path: "assets/Characters/Slime/Animations/Slide/Slide_Front.png" },
      { key: SLIME_SLIDE_EAST_KEY, path: "assets/Characters/Slime/Animations/Slide/Slide_Right.png" },
      { key: SLIME_SLIDE_WEST_KEY, path: "assets/Characters/Slime/Animations/Slide/Slide_Left.png" },
      {
        key: SLIME_SLIDE_NORTH_EAST_KEY,
        path: "assets/Characters/Slime/Animations/Slide/Slide_BackRight.png",
      },
      {
        key: SLIME_SLIDE_NORTH_WEST_KEY,
        path: "assets/Characters/Slime/Animations/Slide/Slide_BackLeft.png",
      },
      {
        key: SLIME_SLIDE_SOUTH_EAST_KEY,
        path: "assets/Characters/Slime/Animations/Slide/Slide_FrontRight.png",
      },
      {
        key: SLIME_SLIDE_SOUTH_WEST_KEY,
        path: "assets/Characters/Slime/Animations/Slide/Slide_FrontLeft.png",
      },
    ];

    for (const sheet of slimeSheets) {
      this.load.spritesheet(sheet.key, sheet.path, {
        frameWidth: 64,
        frameHeight: 64,
        endFrame: 3,
      });
    }
  }

  create() {
    this.matter.world.setGravity(0, 0);

    const mw = this.matter.world;
    mw.drawDebug = false;

    if (mw.drawDebug && !mw.debugGraphic) {
      mw.createDebugGraphic();
    }

    if (mw.debugGraphic) {
      mw.debugGraphic.setVisible(true);
      mw.debugGraphic.setDepth(9999);
      this.children.bringToTop(mw.debugGraphic);
    }

    this.ensureGeneratedTextures();
    this.createKnightAnimations();
    this.createSlimeAnimations();
    this.buildMap();
    this.spawnPlayer();
    this.initializeEncounterSystem();
    this.setupPauseControls();
    this.bindGlobalEvents();
    this.notifyOverworldActive(true);

    if (this.player && this.map) {
      const { widthInPixels, heightInPixels } = this.map;
      this.matter.world.setBounds(0, 0, widthInPixels, heightInPixels, 32, true, true, true, true);
      const camera = this.cameras.main;
      camera.setBounds(0, 0, widthInPixels, heightInPixels);
      camera.startFollow(this.player, true, 1, 1);
      camera.setRoundPixels(true);
      const integerZoom = Math.max(1, Math.round(CAMERA_ZOOM));
      camera.setZoom(integerZoom);
      this.createMinimap();
    }
  }

  update(_time: number, _delta: number) {
    this.pollPauseToggle();

    if (this.isPaused) {
      if (this.player) {
        this.player.setVelocity(0, 0);
      }
      this.updateMinimapIndicator();
      return;
    }

    this.updatePlayerMovement();
    this.updateMinimapIndicator();
  }

  private ensureGeneratedTextures() {
    this.ensureCircleTexture(PLAYER_TEXTURE_KEY, 24, 12, 0xf1f2f6, 0x5a63ff, 2);

    for (const config of Object.values(ENCOUNTER_CONFIGS)) {
      this.ensureCircleTexture(config.textureKey, config.radius * 2 + 4, config.radius, config.fill, config.stroke, 2);
    }
  }

  private ensureCircleTexture(
    key: string,
    textureSize: number,
    radius: number,
    fill: number,
    stroke: number,
    strokeWidth: number,
  ) {
    if (this.textures.exists(key)) {
      return;
    }

    const graphics = this.add.graphics({ x: 0, y: 0 });
    graphics.setVisible(false);
    graphics.fillStyle(fill, 1);
    const center = textureSize * 0.5;
    graphics.fillCircle(center, center, radius);
    if (strokeWidth > 0) {
      graphics.lineStyle(strokeWidth, stroke, 1);
      graphics.strokeCircle(center, center, radius);
    }
    graphics.generateTexture(key, textureSize, textureSize);
    graphics.destroy();
  }

  private normalizeTilesetData(cacheKey: string) {
    const cachedMap = this.cache.tilemap.get(cacheKey);
    const tilesets = cachedMap?.data?.tilesets;

    if (!Array.isArray(tilesets)) {
      return;
    }

    for (const entry of tilesets) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const tileset = entry as {
        tileproperties?: Record<string, unknown>;
        tileProperties?: unknown[];
      } & Record<string, unknown>;

      if (!tileset.tileproperties || typeof tileset.tileproperties !== "object") {
        tileset.tileproperties = {};
      }

      if (!Array.isArray(tileset.tileProperties)) {
        const normalized: unknown[] = [];
        for (const key of Object.keys(tileset.tileproperties)) {
          const index = Number(key);
          if (Number.isNaN(index)) {
            continue;
          }
          normalized[index] = tileset.tileproperties[key];
        }
        tileset.tileProperties = normalized;
      }

      if (!Array.isArray(tileset.tileProperties)) {
        tileset.tileProperties = [];
      }
    }
  }

  private buildMap() {
    this.normalizeTilesetData(MAP_KEY);
    const map = this.make.tilemap({ key: MAP_KEY });
    const tileset = map.addTilesetImage(TILESET_KEY, TILESET_KEY);

    if (!tileset) {
      console.warn(`Tileset ${TILESET_KEY} is not loaded.`);
      return;
    }

    this.layers.clear();
    this.map = map;

    const tilesets = [tileset];

    for (const layerName of LAYERS_BELOW_PLAYER) {
      this.obtainLayer(map, tilesets, layerName, GROUND_LAYER_DEPTH);
    }

    for (const layerName of COLLISION_LAYER_NAMES) {
      const depth = COLLISION_LAYER_DEPTH_OVERRIDES[layerName] ?? GROUND_LAYER_DEPTH;
      const layer = this.obtainLayer(map, tilesets, layerName, depth);
      if (!layer) {
        continue;
      }
      layer.setCollisionFromCollisionGroup(true, true);
      this.matter.world.convertTilemapLayer(layer, {
        isStatic: true,
        friction: 0,
        restitution: 0,
        label: `${layerName}-collider`,
      });
    }

    for (const [layerName, depth] of Object.entries(TOP_LAYER_DEPTHS)) {
      this.obtainLayer(map, tilesets, layerName, depth);
    }
  }

  private initializeEncounterSystem() {
    if (!this.map) {
      return;
    }

    this.rebuildSpawnZones();
    this.spawnEncounterSensors();
    this.attachEncounterCollisionHandler();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanupEncounters, this);
  }

  private rebuildSpawnZones() {
    this.spawnZones = [];

    if (!this.map) {
      return;
    }

    const world = getActiveWorld();
    const defeated = new Set(world?.defeatedSpawnZones ?? []);

    for (const [layerName, kind] of Object.entries(ENCOUNTER_LAYER_MAP)) {
      const layer = this.map.getObjectLayer(layerName);
      if (!layer || !Array.isArray(layer.objects)) {
        continue;
      }

      for (const object of layer.objects) {
        const polygon = this.tiledObjectToPolygon(object);
        if (!polygon) {
          continue;
        }

        const rawId =
          object.id ?? object.name ?? `${Math.round(object.x ?? 0)}-${Math.round(object.y ?? 0)}`;
        const id = `${layerName}-${rawId}`;
        if (defeated.has(id)) {
          continue;
        }
        this.spawnZones.push({ id, kind, polygon });
      }
    }
  }

  private spawnEncounterSensors() {
    this.cleanupEncounterSprites();

    if (!this.map || this.spawnZones.length === 0) {
      return;
    }

    for (const zone of this.spawnZones) {
      const config = ENCOUNTER_CONFIGS[zone.kind];
      if (!config) {
        continue;
      }

      const point = this.getRandomPointInPolygon(zone.polygon);
      const sensor = this.matter.add.sprite(point.x, point.y, config.textureKey, undefined, {
        isSensor: true,
        isStatic: true,
        label: config.label,
        ignoreGravity: true,
      });

      sensor.setDepth(ENCOUNTER_DEPTH);
      sensor.setCircle(config.radius);
      sensor.setStatic(true);
      sensor.setIgnoreGravity(true);
      sensor.setAlpha(0);
      sensor.setVisible(false);
      sensor.setData("encounterZone", zone.id);

      const display = this.add.sprite(point.x, point.y, SLIME_STILL_KEY, 0);
      display.setDepth(ENCOUNTER_DEPTH);
      display.setOrigin(0.5, 0.75);
      const body = sensor.body as MatterJS.BodyType | null;
      if (body) {
        this.indexZoneBody(body, zone);
      }

      const instance: SpawnZoneInstance = { zone, sensor, display, facing: "south" };
      this.playSlimeIdle(instance);
      this.spawnZoneInstances.set(zone.id, instance);
      this.scheduleSpawnZoneWander(instance);
    }
  }

  private attachEncounterCollisionHandler() {
    if (this.matterCollisionAttached) {
      return;
    }
    this.matter.world.on("collisionstart", this.handleCollisionStart, this);
    this.matterCollisionAttached = true;
  }

  private detachEncounterCollisionHandler() {
    if (!this.matterCollisionAttached) {
      return;
    }
    this.matter.world.off("collisionstart", this.handleCollisionStart, this);
    this.matterCollisionAttached = false;
  }

  private cleanupEncounterSprites() {
    if (this.spawnZoneInstances.size === 0) {
      this.spawnZoneBodies.clear();
      return;
    }

    for (const instance of this.spawnZoneInstances.values()) {
      this.stopSpawnZoneWander(instance);
      const { sensor, display } = instance;
      const body = sensor.body as MatterJS.BodyType | null;
      if (body) {
        this.unindexZoneBody(body);
      }
      sensor.destroy();
      display.destroy();
    }

    this.spawnZoneInstances.clear();
    this.spawnZoneBodies.clear();
  }

  private cleanupEncounters() {
    this.detachEncounterCollisionHandler();
    this.cleanupEncounterSprites();
    this.spawnZones = [];
    this.encounterActive = false;
  }

  private tiledObjectToPolygon(object: Phaser.Types.Tilemaps.TiledObject): Phaser.Geom.Polygon | undefined {
    if (!object || !Array.isArray(object.polygon) || object.polygon.length < 3) {
      return undefined;
    }

    const originX = object.x ?? 0;
    const originY = object.y ?? 0;
    const points = object.polygon.map((pt) => ({ x: originX + pt.x, y: originY + pt.y }));
    return new Phaser.Geom.Polygon(points as Phaser.Types.Math.Vector2Like[]);
  }

  private getRandomPointInPolygon(polygon: Phaser.Geom.Polygon): Phaser.Math.Vector2 {
    const bounds = Phaser.Geom.Polygon.GetAABB(polygon);
    const point = new Phaser.Math.Vector2(bounds.centerX, bounds.centerY);

    if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) {
      const centroid = this.computePolygonCentroid(polygon);
      return point.set(centroid.x, centroid.y);
    }

    for (let i = 0; i < 20; i += 1) {
      const x = bounds.x + Math.random() * bounds.width;
      const y = bounds.y + Math.random() * bounds.height;
      if (polygon.contains(x, y)) {
        return point.set(x, y);
      }
    }

    const centroidFallback = this.computePolygonCentroid(polygon);
    return point.set(centroidFallback.x, centroidFallback.y);
  }

  private scheduleSpawnZoneWander(instance: SpawnZoneInstance) {
    if (instance.wanderTimer) {
      instance.wanderTimer.remove(false);
      instance.wanderTimer = undefined;
    }

    const current = new Phaser.Math.Vector2(instance.display.x, instance.display.y);
    const target = this.getNextWanderTarget(instance.zone.polygon, current);

    if (!target) {
      instance.wanderTarget = undefined;
      this.playSlimeIdle(instance);
      return;
    }

    const distance = Phaser.Math.Distance.Between(current.x, current.y, target.x, target.y);

    if (distance < 2) {
      this.playSlimeIdle(instance);
      const delay = Phaser.Math.Between(ENCOUNTER_WANDER_MIN_DELAY, ENCOUNTER_WANDER_MAX_DELAY);
      instance.wanderTimer = this.time.delayedCall(delay, () => {
        if (!this.spawnZoneInstances.has(instance.zone.id)) {
          return;
        }
        instance.wanderTimer = undefined;
        this.scheduleSpawnZoneWander(instance);
      });
      return;
    }

    instance.wanderTarget = target.clone();
    const deltaX = target.x - current.x;
    const deltaY = target.y - current.y;
    this.playSlimeDirectionalAnimation(instance, deltaX, deltaY);
    const duration = Math.max((distance / ENCOUNTER_WANDER_SPEED) * 1000, ENCOUNTER_WANDER_MIN_DURATION);
    instance.wanderTween = this.tweens.add({
      targets: instance.display,
      x: target.x,
      y: target.y,
      duration,
      onComplete: () => {
        instance.wanderTween = undefined;
        if (!this.spawnZoneInstances.has(instance.zone.id)) {
          return;
        }
        this.playSlimeIdle(instance);
        const delay = Phaser.Math.Between(ENCOUNTER_WANDER_MIN_DELAY, ENCOUNTER_WANDER_MAX_DELAY);
        instance.wanderTimer = this.time.delayedCall(delay, () => {
          if (!this.spawnZoneInstances.has(instance.zone.id)) {
            return;
          }
          instance.wanderTimer = undefined;
          this.scheduleSpawnZoneWander(instance);
        });
      },
    });
  }

  private stopSpawnZoneWander(instance: SpawnZoneInstance) {
    if (instance.wanderTween) {
      instance.wanderTween.stop();
      this.tweens.remove(instance.wanderTween);
      instance.wanderTween = undefined;
    }

    if (instance.wanderTimer) {
      instance.wanderTimer.remove(false);
      instance.wanderTimer = undefined;
    }

    instance.wanderTarget = undefined;
    this.playSlimeIdle(instance);
  }

  private getNextWanderTarget(
    polygon: Phaser.Geom.Polygon,
    origin: Phaser.Math.Vector2,
  ): Phaser.Math.Vector2 | undefined {
    const target = new Phaser.Math.Vector2();

    for (let attempt = 0; attempt < 25; attempt += 1) {
      const candidate = this.getRandomPointInPolygon(polygon);
      if (this.segmentWithinPolygon(origin, candidate, polygon)) {
        return target.set(candidate.x, candidate.y);
      }
    }

    const centroid = this.computePolygonCentroid(polygon);
    if (this.segmentWithinPolygon(origin, centroid, polygon)) {
      return target.set(centroid.x, centroid.y);
    }

    if (polygon.contains(origin.x, origin.y)) {
      return target.set(origin.x, origin.y);
    }

    return undefined;
  }

  private segmentWithinPolygon(
    start: Phaser.Math.Vector2,
    end: Phaser.Math.Vector2,
    polygon: Phaser.Geom.Polygon,
  ): boolean {
    const distance = Phaser.Math.Distance.Between(start.x, start.y, end.x, end.y);
    const steps = Math.max(2, Math.ceil(distance / 8));

    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = Phaser.Math.Linear(start.x, end.x, t);
      const y = Phaser.Math.Linear(start.y, end.y, t);
      if (!polygon.contains(x, y)) {
        return false;
      }
    }

    return true;
  }

  private computePolygonCentroid(polygon: Phaser.Geom.Polygon): Phaser.Math.Vector2 {
    const points = polygon.points;
    if (!points || points.length === 0) {
      return new Phaser.Math.Vector2(0, 0);
    }

    let areaSum = 0;
    let centroidX = 0;
    let centroidY = 0;

    for (let i = 0; i < points.length; i += 1) {
      const current = points[i];
      const next = points[(i + 1) % points.length];
      const cross = current.x * next.y - next.x * current.y;
      areaSum += cross;
      centroidX += (current.x + next.x) * cross;
      centroidY += (current.y + next.y) * cross;
    }

    const area = areaSum * 0.5;
    if (Math.abs(area) < 1e-5) {
      const fallback = points[0];
      return new Phaser.Math.Vector2(fallback.x, fallback.y);
    }

    const factor = 1 / (6 * area);
    return new Phaser.Math.Vector2(centroidX * factor, centroidY * factor);
  }

  private indexZoneBody(body: MatterJS.BodyType, zone: SpawnZone) {
    this.spawnZoneBodies.set(body, zone);
    if (Array.isArray(body.parts)) {
      for (const part of body.parts) {
        this.spawnZoneBodies.set(part as MatterJS.BodyType, zone);
      }
    }
  }

  private unindexZoneBody(body: MatterJS.BodyType) {
    this.spawnZoneBodies.delete(body);
    if (Array.isArray(body.parts)) {
      for (const part of body.parts) {
        this.spawnZoneBodies.delete(part as MatterJS.BodyType);
      }
    }
  }

  private getZoneFromBody(body: MatterJS.BodyType | null | undefined): SpawnZone | undefined {
    if (!body) {
      return undefined;
    }

    const direct = this.spawnZoneBodies.get(body);
    if (direct) {
      return direct;
    }

    const parent = body.parent as MatterJS.BodyType | undefined;
    if (parent && parent !== body) {
      return this.spawnZoneBodies.get(parent);
    }

    return undefined;
  }

  private bodyBelongsToPlayer(body: MatterJS.BodyType | null | undefined): boolean {
    if (!body || !this.player || !this.player.body) {
      return false;
    }

    const playerBody = this.player.body as MatterJS.BodyType;
    if (body === playerBody) {
      return true;
    }

    if (body.parent === playerBody) {
      return true;
    }

    return playerBody.parent === body;
  }

  private handleCollisionStart = (event: Phaser.Physics.Matter.Events.CollisionStartEvent) => {
    if (this.encounterActive || !this.player) {
      return;
    }

    for (const pair of event.pairs) {
      if (this.encounterActive) {
        break;
      }

      const zoneA = this.getZoneFromBody(pair.bodyA);
      const zoneB = this.getZoneFromBody(pair.bodyB);

      if (zoneA && this.bodyBelongsToPlayer(pair.bodyB)) {
        this.startBattleForZone(zoneA);
      } else if (zoneB && this.bodyBelongsToPlayer(pair.bodyA)) {
        this.startBattleForZone(zoneB);
      }
    }
  };

  private startBattleForZone(zone: SpawnZone) {
    if (this.encounterActive) {
      return;
    }

    const config = ENCOUNTER_CONFIGS[zone.kind];
    if (!config) {
      return;
    }

    const profile = getActiveProfile();
    if (!profile) {
      console.warn("Encounter triggered without an active player profile.");
      return;
    }

    const world = getActiveWorld() ?? createDefaultWorld();

    if (this.player) {
      world.lastOverworldPosition = { x: this.player.x, y: this.player.y };
    }

    saveActiveCharacter(profile, world);

    this.encounterActive = true;
    this.detachEncounterCollisionHandler();
    this.removeZoneInstance(zone);

    this.scene.start("Battle", {
      profile,
      world,
      enemyId: config.enemyId,
      enemyLevel: config.enemyLevel,
      spawnZoneId: zone.id,
    });
  }

  private removeZoneInstance(zone: SpawnZone) {
    const instance = this.spawnZoneInstances.get(zone.id);
    if (!instance) {
      return;
    }

    const body = instance.sensor.body as MatterJS.BodyType | null;
    if (body) {
      this.unindexZoneBody(body);
    }

    this.stopSpawnZoneWander(instance);
    instance.sensor.destroy();
    instance.display.destroy();
    this.spawnZoneInstances.delete(zone.id);
  }

  private obtainLayer(
    map: Phaser.Tilemaps.Tilemap,
    tilesets: Phaser.Tilemaps.Tileset[],
    layerName: string,
    depth?: number,
  ): Phaser.Tilemaps.TilemapLayer | undefined {
    const existing = this.layers.get(layerName);
    if (existing) {
      if (typeof depth === "number") {
        existing.setDepth(depth);
      }
      return existing;
    }
    const created = map.createLayer(layerName, tilesets, 0, 0);
    if (created) {
      if (typeof depth === "number") {
        created.setDepth(depth);
      }
      this.layers.set(layerName, created);
    }
    return created ?? undefined;
  }

  private spawnPlayer() {
    const spawn = this.determineSpawnPoint();
    const profile = getActiveProfile();

    if (profile?.clazz === "Knight") {
      this.playerFacing = "south";
      const textureKey = this.resolveKnightTextureKey(this.playerFacing) ?? KNIGHT_WALK_SOUTH_KEY;
      const display = this.add.sprite(spawn.x, spawn.y, textureKey, 0);
      display.setDepth(PLAYER_DEPTH);
      display.setOrigin(0.5, 0.75);
      const player = this.matter.add.gameObject(display, {
        frictionAir: 0.02,
        ignoreGravity: true,
        label: "player",
      }) as Phaser.Physics.Matter.Sprite;
      player.setRectangle(28, 40);
      player.setFixedRotation();
      player.setFriction(0, 0, 0);
      player.setFrictionAir(0.02);
      player.setBounce(0);
      player.setIgnoreGravity(true);
      this.player = player;
      this.isKnightPlayer = true;
      this.setKnightIdleFrame();
    } else {
      const player = this.matter.add.sprite(spawn.x, spawn.y, PLAYER_TEXTURE_KEY, undefined, {
        frictionAir: 0.02,
        ignoreGravity: true,
        label: "player",
      });
      player.setDepth(PLAYER_DEPTH);
      player.setCircle(10);
      player.setFixedRotation();
      player.setFriction(0, 0, 0);
      player.setFrictionAir(0.02);
      player.setBounce(0);
      player.setIgnoreGravity(true);
      this.player = player;
      this.isKnightPlayer = false;
    }

    const keyboard = this.input.keyboard;
    if (keyboard) {
      this.keys = keyboard.addKeys({
        W: Phaser.Input.Keyboard.KeyCodes.W,
        A: Phaser.Input.Keyboard.KeyCodes.A,
        S: Phaser.Input.Keyboard.KeyCodes.S,
        D: Phaser.Input.Keyboard.KeyCodes.D,
      }) as WASDKeys;
    }
  }

  private setupPauseControls() {
    const keyboard = this.input.keyboard;
    if (!keyboard) {
      return;
    }
    this.pauseKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    keyboard.addCapture(Phaser.Input.Keyboard.KeyCodes.ESC);
  }

  private cleanupPauseControls() {
    if (this.pauseKey) {
      this.pauseKey.destroy();
      this.pauseKey = undefined;
    }
    this.input.keyboard?.removeCapture(Phaser.Input.Keyboard.KeyCodes.ESC);
  }

  private pollPauseToggle() {
    if (!this.pauseKey) {
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.pauseKey)) {
      this.setPaused(!this.isPaused);
    }
  }

  private setPaused(paused: boolean) {
    if (this.isPaused === paused) {
      return;
    }

    this.isPaused = paused;

    if (paused) {
      this.matter.world.pause();
      if (this.player) {
        this.player.setVelocity(0, 0);
      }
    } else {
      this.matter.world.resume();
    }

    this.game.events.emit(OVERWORLD_EVENT_PAUSE_CHANGED, paused);
  }

  private handleResumeRequest() {
    this.setPaused(false);
  }

  private handleSaveRequest() {
    const profile = getActiveProfile();
    if (!profile) {
      this.game.events.emit(OVERWORLD_EVENT_SAVE_COMPLETE, {
        success: false,
        message: "No active character selected.",
      });
      return;
    }

    const world = getActiveWorld() ?? createDefaultWorld();

    if (this.player) {
      world.lastOverworldPosition = { x: this.player.x, y: this.player.y };
    }

    saveActiveCharacter(profile, world);

    this.game.events.emit(OVERWORLD_EVENT_SAVE_COMPLETE, {
      success: true,
      message: "Game saved.",
    });
  }

  private bindGlobalEvents() {
    const events = this.game.events;
    events.on(OVERWORLD_EVENT_RESUME_REQUEST, this.handleResumeRequest, this);
    events.on(OVERWORLD_EVENT_SAVE_REQUEST, this.handleSaveRequest, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      events.off(OVERWORLD_EVENT_RESUME_REQUEST, this.handleResumeRequest, this);
      events.off(OVERWORLD_EVENT_SAVE_REQUEST, this.handleSaveRequest, this);
      if (this.isPaused) {
        this.setPaused(false);
      }
      this.notifyOverworldActive(false);
      this.cleanupPauseControls();
    });

    this.events.once(Phaser.Scenes.Events.DESTROY, this.cleanupPauseControls, this);
  }

  private notifyOverworldActive(active: boolean) {
    this.game.events.emit(OVERWORLD_EVENT_ACTIVE, active);
  }

  private updatePlayerMovement() {
    if (!this.player || !this.keys) {
      return;
    }

    let moveX = 0;
    let moveY = 0;

    if (this.keys.W.isDown) moveY -= 1;
    if (this.keys.S.isDown) moveY += 1;
    if (this.keys.A.isDown) moveX -= 1;
    if (this.keys.D.isDown) moveX += 1;

    if (!moveX && !moveY) {
      this.player.setVelocity(0, 0);
      if (this.isKnightPlayer) {
        this.setKnightIdleFrame();
      }
      return;
    }

    const length = Math.hypot(moveX, moveY) || 1;
    const vx = (moveX / length) * PLAYER_SPEED;
    const vy = (moveY / length) * PLAYER_SPEED;

    this.player.setVelocity(vx, vy);
    if (this.isKnightPlayer) {
      this.updateKnightAnimation(moveX, moveY);
    }
  }

  private createSlimeAnimations() {
    if (!this.anims.exists(SLIME_ANIM_IDLE)) {
      this.anims.create({
        key: SLIME_ANIM_IDLE,
        frames: [{ key: SLIME_STILL_KEY }],
        frameRate: 1,
        repeat: -1,
      });
    }

    const animations: Array<{ key: string; sheet: string }> = [
      { key: SLIME_ANIM_SLIDE_NORTH, sheet: SLIME_SLIDE_NORTH_KEY },
      { key: SLIME_ANIM_SLIDE_SOUTH, sheet: SLIME_SLIDE_SOUTH_KEY },
      { key: SLIME_ANIM_SLIDE_EAST, sheet: SLIME_SLIDE_EAST_KEY },
      { key: SLIME_ANIM_SLIDE_WEST, sheet: SLIME_SLIDE_WEST_KEY },
      { key: SLIME_ANIM_SLIDE_NORTH_EAST, sheet: SLIME_SLIDE_NORTH_EAST_KEY },
      { key: SLIME_ANIM_SLIDE_NORTH_WEST, sheet: SLIME_SLIDE_NORTH_WEST_KEY },
      { key: SLIME_ANIM_SLIDE_SOUTH_EAST, sheet: SLIME_SLIDE_SOUTH_EAST_KEY },
      { key: SLIME_ANIM_SLIDE_SOUTH_WEST, sheet: SLIME_SLIDE_SOUTH_WEST_KEY },
    ];

    for (const config of animations) {
      if (this.anims.exists(config.key)) {
        continue;
      }
      this.anims.create({
        key: config.key,
        frames: this.anims.generateFrameNumbers(config.sheet, { start: 0, end: 3 }),
        frameRate: 8,
        repeat: -1,
      });
    }
  }

  private playSlimeIdle(instance: SpawnZoneInstance) {
    const sprite = instance.display;
    if (!sprite || !sprite.scene) {
      return;
    }
    sprite.anims?.stop();
    const textureKey = this.resolveSlimeTextureKey(instance.facing);
    if (textureKey) {
      sprite.setTexture(textureKey, 0);
      return;
    }
    sprite.setTexture(SLIME_STILL_KEY, 0);
  }

  private playSlimeDirectionalAnimation(instance: SpawnZoneInstance, dx: number, dy: number) {
    const sprite = instance.display;
    if (!sprite || !sprite.scene || !sprite.anims) {
      return;
    }
    const facing = this.resolveSlimeFacing(dx, dy, instance.facing);
    if (!facing) {
      this.playSlimeIdle(instance);
      return;
    }
    const animKey = this.resolveSlimeAnimationKey(facing);
    if (!animKey) {
      instance.facing = facing;
      this.playSlimeIdle(instance);
      return;
    }
    if (sprite.anims.currentAnim?.key === animKey && sprite.anims.isPlaying) {
      instance.facing = facing;
      return;
    }
    instance.facing = facing;
    sprite.anims.play(animKey, true);
  }

  private resolveSlimeFacing(dx: number, dy: number, fallback?: SlimeFacing): SlimeFacing | undefined {
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const threshold = 0.001;

    if (absX < threshold && absY < threshold) {
      return fallback;
    }

    const maxAxis = Math.max(absX, absY);
    const minAxis = Math.min(absX, absY);
    const diagonalRatio = maxAxis === 0 ? 0 : minAxis / maxAxis;

    if (diagonalRatio >= 0.45) {
      if (dy < 0) {
        return dx > 0 ? "northEast" : "northWest";
      }
      return dx > 0 ? "southEast" : "southWest";
    }

    if (absY >= absX) {
      return dy < 0 ? "north" : "south";
    }

    return dx < 0 ? "west" : "east";
  }

  private resolveSlimeAnimationKey(direction: SlimeFacing | undefined) {
    switch (direction) {
      case "north":
        return SLIME_ANIM_SLIDE_NORTH;
      case "south":
        return SLIME_ANIM_SLIDE_SOUTH;
      case "east":
        return SLIME_ANIM_SLIDE_EAST;
      case "west":
        return SLIME_ANIM_SLIDE_WEST;
      case "northEast":
        return SLIME_ANIM_SLIDE_NORTH_EAST;
      case "northWest":
        return SLIME_ANIM_SLIDE_NORTH_WEST;
      case "southEast":
        return SLIME_ANIM_SLIDE_SOUTH_EAST;
      case "southWest":
        return SLIME_ANIM_SLIDE_SOUTH_WEST;
      default:
        return undefined;
    }
  }

  private resolveSlimeTextureKey(direction: SlimeFacing | undefined) {
    switch (direction) {
      case "north":
        return SLIME_SLIDE_NORTH_KEY;
      case "south":
        return SLIME_SLIDE_SOUTH_KEY;
      case "east":
        return SLIME_SLIDE_EAST_KEY;
      case "west":
        return SLIME_SLIDE_WEST_KEY;
      case "northEast":
        return SLIME_SLIDE_NORTH_EAST_KEY;
      case "northWest":
        return SLIME_SLIDE_NORTH_WEST_KEY;
      case "southEast":
        return SLIME_SLIDE_SOUTH_EAST_KEY;
      case "southWest":
        return SLIME_SLIDE_SOUTH_WEST_KEY;
      default:
        return undefined;
    }
  }

  private createKnightAnimations() {
    const animations: Array<{ key: string; sheet: string }> = [
      { key: KNIGHT_ANIM_WALK_NORTH, sheet: KNIGHT_WALK_NORTH_KEY },
      { key: KNIGHT_ANIM_WALK_SOUTH, sheet: KNIGHT_WALK_SOUTH_KEY },
      { key: KNIGHT_ANIM_WALK_EAST, sheet: KNIGHT_WALK_EAST_KEY },
      { key: KNIGHT_ANIM_WALK_WEST, sheet: KNIGHT_WALK_WEST_KEY },
      { key: KNIGHT_ANIM_WALK_NORTH_EAST, sheet: KNIGHT_WALK_NORTH_EAST_KEY },
      { key: KNIGHT_ANIM_WALK_NORTH_WEST, sheet: KNIGHT_WALK_NORTH_WEST_KEY },
      { key: KNIGHT_ANIM_WALK_SOUTH_EAST, sheet: KNIGHT_WALK_SOUTH_EAST_KEY },
      { key: KNIGHT_ANIM_WALK_SOUTH_WEST, sheet: KNIGHT_WALK_SOUTH_WEST_KEY },
    ];

    for (const config of animations) {
      if (this.anims.exists(config.key)) {
        continue;
      }
      this.anims.create({
        key: config.key,
        frames: this.anims.generateFrameNumbers(config.sheet, { start: 0, end: 3 }),
        frameRate: 8,
        repeat: -1,
      });
    }
  }

  private setKnightIdleFrame() {
    if (!this.player) {
      return;
    }
    this.player.anims.stop();
    const textureKey = this.resolveKnightTextureKey(this.playerFacing) ?? KNIGHT_WALK_SOUTH_KEY;
    this.player.setTexture(textureKey, 0);
  }

  private updateKnightAnimation(moveX: number, moveY: number) {
    if (!this.player) {
      return;
    }

    const absX = Math.abs(moveX);
    const absY = Math.abs(moveY);
    let facing: KnightFacing = this.playerFacing;

    if (moveX !== 0 && moveY !== 0) {
      if (moveY < 0) {
        facing = moveX > 0 ? "northEast" : "northWest";
      } else {
        facing = moveX > 0 ? "southEast" : "southWest";
      }
    } else if (absY >= absX) {
      facing = moveY < 0 ? "north" : "south";
    } else {
      facing = moveX < 0 ? "west" : "east";
    }

    if (this.playerFacing !== facing || !this.player.anims.isPlaying) {
      this.playerFacing = facing;
      const animKey = this.resolveKnightAnimationKey(facing);
      if (animKey) {
        this.player.anims.play(animKey, true);
      }
    }
  }

  private resolveKnightAnimationKey(direction: KnightFacing) {
    switch (direction) {
      case "north":
        return KNIGHT_ANIM_WALK_NORTH;
      case "south":
        return KNIGHT_ANIM_WALK_SOUTH;
      case "east":
        return KNIGHT_ANIM_WALK_EAST;
      case "west":
        return KNIGHT_ANIM_WALK_WEST;
      case "northEast":
        return KNIGHT_ANIM_WALK_NORTH_EAST;
      case "northWest":
        return KNIGHT_ANIM_WALK_NORTH_WEST;
      case "southEast":
        return KNIGHT_ANIM_WALK_SOUTH_EAST;
      case "southWest":
        return KNIGHT_ANIM_WALK_SOUTH_WEST;
      default:
        return undefined;
    }
  }

  private resolveKnightTextureKey(direction: KnightFacing) {
    switch (direction) {
      case "north":
        return KNIGHT_WALK_NORTH_KEY;
      case "south":
        return KNIGHT_WALK_SOUTH_KEY;
      case "east":
        return KNIGHT_WALK_EAST_KEY;
      case "west":
        return KNIGHT_WALK_WEST_KEY;
      case "northEast":
        return KNIGHT_WALK_NORTH_EAST_KEY;
      case "northWest":
        return KNIGHT_WALK_NORTH_WEST_KEY;
      case "southEast":
        return KNIGHT_WALK_SOUTH_EAST_KEY;
      case "southWest":
        return KNIGHT_WALK_SOUTH_WEST_KEY;
      default:
        return undefined;
    }
  }


  private determineSpawnPoint(): Phaser.Math.Vector2 {
    const outcome = this.initData?.outcome;
    if (outcome !== "defeat") {
      const dataPosition = this.initData?.position;
      if (dataPosition && Number.isFinite(dataPosition.x) && Number.isFinite(dataPosition.y)) {
        return new Phaser.Math.Vector2(dataPosition.x, dataPosition.y);
      }

      const world = getActiveWorld();
      const worldPosition = world?.lastOverworldPosition;
      if (
        worldPosition &&
        Number.isFinite(worldPosition.x) &&
        Number.isFinite(worldPosition.y)
      ) {
        return new Phaser.Math.Vector2(worldPosition.x, worldPosition.y);
      }
    }

    return this.resolvePlayerSpawnPoint();
  }

  private createMinimap() {
    if (!this.map) {
      return;
    }

    const mainCamera = this.cameras.main;
    const viewport = this.computeMinimapViewport(mainCamera.width, mainCamera.height);

    if (!viewport) {
      return;
    }

    const minimap = this.cameras.add(viewport.x, viewport.y, viewport.width, viewport.height);
    minimap.setName("minimap");
    minimap.setRoundPixels(true);
    minimap.setZoom(viewport.zoom);
    minimap.centerOn(this.map.widthInPixels * 0.5, this.map.heightInPixels * 0.5);
    minimap.setBackgroundColor(MINIMAP_BACKGROUND_COLOR);

    const backdrop = this.add.rectangle(0, 0, 10, 10, MINIMAP_BACKGROUND_COLOR, MINIMAP_BACKGROUND_ALPHA);
    backdrop.setOrigin(0.5, 0.5);
    backdrop.setScrollFactor(0);
    backdrop.setDepth(9998);
    backdrop.setStrokeStyle(1, MINIMAP_OUTLINE_COLOR, MINIMAP_OUTLINE_ALPHA);

    const marker = this.add.circle(this.player?.x ?? 0, this.player?.y ?? 0, MINIMAP_INDICATOR_RADIUS, MINIMAP_INDICATOR_COLOR);
    marker.setAlpha(0.9);
    marker.setDepth(MINIMAP_PLAYER_INDICATOR_DEPTH);
    marker.setScrollFactor(1);
    marker.setVisible(false);
    marker.setStrokeStyle(3, MINIMAP_OUTLINE_COLOR, 0.8);

    const ignoredByMinimap: Phaser.GameObjects.GameObject[] = [backdrop];
    if (this.matter.world.debugGraphic) {
      ignoredByMinimap.push(this.matter.world.debugGraphic);
    }
    if (this.player) {
      ignoredByMinimap.push(this.player);
    }
    minimap.ignore(ignoredByMinimap);
    this.cameras.main.ignore(marker);

    this.rebuildMinimapCityMarkers();

    this.minimapCamera = minimap;
    this.minimapBackdrop = backdrop;
    this.minimapMarker = marker;

    this.positionMinimap();
    this.updateMinimapIndicator();

    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleScaleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanupMinimap, this);
  }

  private positionMinimap(sceneWidth?: number, sceneHeight?: number) {
    if (!this.minimapCamera || !this.map) {
      return;
    }

    const width = sceneWidth ?? this.cameras.main.width;
    const height = sceneHeight ?? this.cameras.main.height;
    const viewport = this.computeMinimapViewport(width, height);

    if (!viewport) {
      this.minimapViewport = undefined;
      this.minimapCamera.setVisible(false);
      this.minimapBackdrop?.setVisible(false);
      this.minimapMarker?.setVisible(false);
      return;
    }

    this.minimapViewport = viewport;
    this.minimapCamera.setVisible(true);
    this.minimapCamera.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);
    this.minimapCamera.setZoom(viewport.zoom);
    this.minimapCamera.centerOn(this.map.widthInPixels * 0.5, this.map.heightInPixels * 0.5);

    const frameWidth = viewport.width + MINIMAP_FRAME_PADDING;
    const frameHeight = viewport.height + MINIMAP_FRAME_PADDING;

    if (this.minimapBackdrop) {
      this.minimapBackdrop.setVisible(true);
      this.minimapBackdrop.setPosition(viewport.x + viewport.width * 0.5, viewport.y + viewport.height * 0.5);
      this.minimapBackdrop.setDisplaySize(frameWidth, frameHeight);
    }

    if (this.minimapMarker) {
      this.minimapMarker.setVisible(true);
    }

    this.updateMinimapIndicator();
  }

  private computeMinimapViewport(sceneWidth: number, sceneHeight: number): MinimapViewport | undefined {
    if (!this.map) {
      return undefined;
    }

    const availableWidth = Math.max(sceneWidth - MINIMAP_MARGIN * 2, 0);
    const availableHeight = Math.max(sceneHeight - MINIMAP_MARGIN * 2, 0);

    if (availableWidth < 48 || availableHeight < 48) {
      return undefined;
    }

    const mapWidth = Math.max(this.map.widthInPixels, 1);
    const mapHeight = Math.max(this.map.heightInPixels, 1);
    const mapRatio = mapWidth / mapHeight;

    const targetWidth = Phaser.Math.Clamp(sceneWidth * 0.25, MINIMAP_MIN_SIZE, MINIMAP_MAX_SIZE);
    const targetHeight = Phaser.Math.Clamp(sceneHeight * 0.25, MINIMAP_MIN_SIZE, MINIMAP_MAX_SIZE);

    let width = Math.min(targetWidth, availableWidth);
    let height = width / mapRatio;

    const maxHeight = Math.min(targetHeight, availableHeight);
    if (height > maxHeight) {
      height = maxHeight;
      width = height * mapRatio;
    }

    width = Math.round(Phaser.Math.Clamp(width, 48, availableWidth));
    height = Math.round(Phaser.Math.Clamp(height, 48, availableHeight));

    const zoomX = width / mapWidth;
    const zoomY = height / mapHeight;
    const zoom = Math.min(zoomX, zoomY);

    if (!Number.isFinite(zoom) || zoom <= 0) {
      return undefined;
    }

    const x = sceneWidth - width - MINIMAP_MARGIN;
    const y = MINIMAP_MARGIN;

    return { x, y, width, height, zoom };
  }

  private handleScaleResize(gameSize: Phaser.Structs.Size) {
    this.positionMinimap(gameSize.width, gameSize.height);
  }

  private updateMinimapIndicator() {
    if (!this.player || !this.minimapMarker) {
      return;
    }

    this.minimapMarker.setPosition(this.player.x, this.player.y);
  }

  private cleanupMinimap() {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.handleScaleResize, this);

    if (this.minimapCamera) {
      this.cameras?.remove?.(this.minimapCamera, true);
      this.minimapCamera = undefined;
    }

    this.minimapBackdrop?.destroy();
    this.minimapBackdrop = undefined;

    if (this.minimapMarker) {
      const mainCamera = this.cameras?.main as (Phaser.Cameras.Scene2D.Camera & {
        removeFromRenderList?: (gameObject: Phaser.GameObjects.GameObject) => void;
      }) | undefined;
      mainCamera?.removeFromRenderList?.(this.minimapMarker);
      this.minimapMarker.destroy();
      this.minimapMarker = undefined;
    }
    this.disposeMinimapCityMarkers();
    this.minimapViewport = undefined;
  }

  private resolvePlayerSpawnPoint(): Phaser.Math.Vector2 {
    const layer = this.map?.getObjectLayer("SpawnPoints");
    if (!layer || !layer.objects || layer.objects.length === 0) {
      const width = this.map?.widthInPixels ?? 0;
      const height = this.map?.heightInPixels ?? 0;
      return new Phaser.Math.Vector2(width * 0.5, height * 0.5);
    }
    const spawn = layer.objects.find((obj) => obj.point) ?? layer.objects[0];
    return new Phaser.Math.Vector2(spawn.x ?? 0, spawn.y ?? 0);
  }

  private rebuildMinimapCityMarkers() {
    this.disposeMinimapCityMarkers();

    if (!this.map) {
      return;
    }

    const layer = this.map.getObjectLayer("CityMarkers");
    if (!layer || !Array.isArray(layer.objects) || layer.objects.length === 0) {
      return;
    }

    for (const object of layer.objects) {
      const baseX = object.x ?? 0;
      const baseY = object.y ?? 0;
      const width = object.width ?? 0;
      const height = object.height ?? 0;
      const x = object.point ? baseX : baseX + width * 0.5;
      const y = object.point ? baseY : baseY + height * 0.5;
      const cityMarker = this.add.circle(x, y, 80, 0xF5275E, 1);
      cityMarker.setDepth(MINIMAP_CITY_MARKER_DEPTH);
      cityMarker.setScrollFactor(1);
      cityMarker.setVisible(true);
      this.cameras.main.ignore(cityMarker);
      this.minimapCityMarkers.push(cityMarker);
    }
  }

  private disposeMinimapCityMarkers() {
    if (this.minimapCityMarkers.length === 0) {
      return;
    }

    const mainCamera = this.cameras?.main as Phaser.Cameras.Scene2D.Camera & {
      removeFromRenderList?: (gameObject: Phaser.GameObjects.GameObject) => void;
    };
    for (const marker of this.minimapCityMarkers) {
      mainCamera?.removeFromRenderList?.(marker);
      marker.destroy();
    }

    this.minimapCityMarkers = [];
  }
}
