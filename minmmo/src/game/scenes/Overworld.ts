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

type WASDKeys = Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;

type MinimapViewport = { x: number; y: number; width: number; height: number; zoom: number };

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
    this.buildMap();
    this.spawnPlayer();

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
    this.updatePlayerMovement();
    this.updateMinimapIndicator();
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
    marker.setDepth(PLAYER_DEPTH + 50);
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
      this.cameras.remove(this.minimapCamera, true);
      this.minimapCamera = undefined;
    }

    this.minimapBackdrop?.destroy();
    this.minimapBackdrop = undefined;

    if (this.minimapMarker) {
      this.cameras.main.removeFromRenderList(this.minimapMarker);
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
      const cityMarker = this.add.circle(x, y, 6, 0xfbd46d, 1);
      cityMarker.setDepth(PLAYER_DEPTH + 25);
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

    const mainCamera = this.cameras?.main;
    for (const marker of this.minimapCityMarkers) {
      if (mainCamera) {
        mainCamera.removeFromRenderList(marker);
      }
      marker.destroy();
    }

    this.minimapCityMarkers = [];
  }
}
