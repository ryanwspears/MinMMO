import Phaser from "phaser";

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
const PLAYER_SPEED = 3;
const CAMERA_ZOOM = 1.3;

type WASDKeys = Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;

export class Overworld extends Phaser.Scene {
  private map?: Phaser.Tilemaps.Tilemap;
  private layers = new Map<string, Phaser.Tilemaps.TilemapLayer>();
  private player?: Phaser.Physics.Matter.Sprite;
  private keys?: WASDKeys;

  constructor() {
    super("Overworld");
  }

  preload() {
    this.load.tilemapTiledJSON(MAP_KEY, MAP_JSON_PATH);
    this.load.image(TILESET_KEY, TILESET_IMAGE_PATH);
  }

  create() {
    this.matter.world.setGravity(0, 0);

    const mw = this.matter.world;
    mw.drawDebug = true;

    if (mw.drawDebug && !mw.debugGraphic) {
      mw.createDebugGraphic();
    }

    if (mw.debugGraphic) {
      mw.debugGraphic.setVisible(true);
      mw.debugGraphic.setDepth(9999);
      this.children.bringToTop(mw.debugGraphic);
    }

    this.ensureGeneratedTextures();
    this.buildMap();
    this.spawnPlayer();

    if (this.player && this.map) {
      const { widthInPixels, heightInPixels } = this.map;
      this.matter.world.setBounds(0, 0, widthInPixels, heightInPixels, 32, true, true, true, true);
      this.cameras.main.setBounds(0, 0, widthInPixels, heightInPixels);
      this.cameras.main.startFollow(this.player);
      this.cameras.main.setLerp(0.2, 0.2);
      this.cameras.main.setZoom(CAMERA_ZOOM);
    }
  }

  update(_time: number, _delta: number) {
    this.updatePlayerMovement();
  }

  private ensureGeneratedTextures() {
    if (!this.textures.exists(PLAYER_TEXTURE_KEY)) {
      const graphics = this.add.graphics({ x: 0, y: 0 });
      graphics.setVisible(false);
      graphics.fillStyle(0xf1f2f6, 1);
      graphics.fillCircle(12, 12, 12);
      graphics.lineStyle(2, 0x5a63ff, 1);
      graphics.strokeCircle(12, 12, 12);
      graphics.generateTexture(PLAYER_TEXTURE_KEY, 24, 24);
      graphics.destroy();
    }
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
    const spawn = this.resolvePlayerSpawnPoint();
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
      return;
    }

    const length = Math.hypot(moveX, moveY) || 1;
    const vx = (moveX / length) * PLAYER_SPEED;
    const vy = (moveY / length) * PLAYER_SPEED;

    this.player.setVelocity(vx, vy);
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
}