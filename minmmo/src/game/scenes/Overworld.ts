import Phaser from 'phaser';

const TILESET_PATH = 'assets/mapOne/tiles/';
const TILESET_RESOURCES: Record<string, string> = {
  test_grass_tiles: 'test_grass_tiles.png',
  test_water_tiles: 'test_water_tiles.png',
  test_cityGround_tiles: 'test_cityGround_tiles.png',
  test_wall_tiles: 'test_wall_tiles.png',
  test_buildings_tiles: 'test_buildings_tiles.png',
  test_structures_tiles: 'test_structures_tiles.png',
  test_road_tiles: 'test_road_tiles.png',
  test_dirt_tiles: 'test_dirt_tiles.png',
  test_plants_tiles: 'test_plants_tiles.png',
  test_waterDecs_tiles: 'test_waterDecs_tiles.png',
  test_rocks_tiles: 'test_rocks_tiles.png',
};

const BASE_LAYER_ORDER = [
  'Ocean',
  'Grass',
  'Plants',
  'Dirt',
  'Rocks',
  'Water',
  'Road',
  'CityGround',
  'Spawns',
];

const COLLISION_LAYER_NAMES = [
  'Walls',
  'Houses',
  'Shops',
  'Structures',
  'TreesBottom',
  'Water',
  'Ocean',
];

const TOP_LAYER_NAME = 'TreesTop';
const PLAYER_TEXTURE_KEY = 'overworld-player';
const PLAYER_DEPTH = 200;
const COLLISION_LAYER_DEPTH = PLAYER_DEPTH - 20;
const TOP_LAYER_DEPTH = 400;
const MERCHANT_DEPTH = PLAYER_DEPTH + 1;
const CITY_MARKER_DEPTH = PLAYER_DEPTH + 2;
const PLAYER_SPEED = 110;
const MERCHANT_SPEED = 120;
const CAMERA_ZOOM = 1.3;

type WASDKeys = Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
type TiledProperty = { name: string; value: unknown; type?: string };

interface RouteState {
  points: Phaser.Math.Vector2[];
  index: number;
}

export class Overworld extends Phaser.Scene {
  private map?: Phaser.Tilemaps.Tilemap;
  private layers = new Map<string, Phaser.Tilemaps.TilemapLayer>();
  private player?: Phaser.Physics.Matter.Sprite;
  private keys?: WASDKeys;
  private merchant?: Phaser.GameObjects.Ellipse;
  private merchantRoute: RouteState = { points: [], index: 0 };
  private enemySpawnAreas: Phaser.Math.Vector2[][] = [];
  private ogreSpawnAreas: Phaser.Math.Vector2[][] = [];
  private wraithSpawnAreas: Phaser.Math.Vector2[][] = [];
  private cityMarkers: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('Overworld');
  }

  preload() {
    this.load.tilemapTiledJSON('mapOne', 'assets/mapOne/MapOne.json');
    for (const [key, file] of Object.entries(TILESET_RESOURCES)) {
      this.load.image(key, `${TILESET_PATH}${file}`);
    }
  }

  create() {
    this.matter.world.setGravity(0, 0);
    this.matter.world.drawDebug = false;
    if (this.matter.world.debugGraphic) {
      this.matter.world.debugGraphic.clear();
      this.matter.world.debugGraphic.visible = false;
    }

    this.ensureGeneratedTextures();
    this.buildMap();
    this.spawnPlayer();
    this.buildMerchant();
    this.renderCityMarkers();
    this.captureSpawnLayers();

    if (this.player && this.map) {
      const { widthInPixels, heightInPixels } = this.map;
      this.matter.world.setBounds(0, 0, widthInPixels, heightInPixels, 32, true, true, true, true);
      this.cameras.main.setBounds(0, 0, widthInPixels, heightInPixels);
      this.cameras.main.startFollow(this.player);
      this.cameras.main.setLerp(0.2, 0.2);
      this.cameras.main.setZoom(CAMERA_ZOOM);
    }
  }

  update(_time: number, delta: number) {
    this.updatePlayerMovement();
    this.updateMerchant(delta);
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

  private markCollidableTiles(map: Phaser.Tilemaps.Tilemap) {
    for (const tileset of map.tilesets) {
      const data = (tileset as any).tileData as Record<string, any> | undefined;
      if (!data) continue;
      for (const tile of Object.values(data)) {
        if (!tile || typeof tile !== 'object') continue;
        const collisionObjects = tile.objectgroup?.objects;
        if (!collisionObjects || !collisionObjects.length) continue;
        if (!Array.isArray(tile.properties)) {
          tile.properties = [];
        }
        if (!tile.properties.some((prop: any) => prop?.name === 'collides')) {
          tile.properties.push({ name: 'collides', type: 'bool', value: true });
        }
      }
    }
  }
  private buildMap() {
    this.normalizeTilesetData('mapOne');
    const map = this.make.tilemap({ key: 'mapOne' });
    const tilesets: Phaser.Tilemaps.Tileset[] = [];
    for (const tileset of map.tilesets) {
      const textureKey = this.resolveTilesetTextureKey(tileset);
      if (!textureKey) {
        continue;
      }
      const added = map.addTilesetImage(tileset.name || textureKey, textureKey);
      if (added) {
        tilesets.push(added);
      }
    }
    this.map = map;

    const depthStep = 10;
    BASE_LAYER_ORDER.forEach((layerName, index) => {
      const layer = map.createLayer(layerName, tilesets, 0, 0);
      if (layer) {
        layer.setDepth(index * depthStep);
        this.layers.set(layerName, layer);
      }
    });

    for (const layerName of COLLISION_LAYER_NAMES) {
      const existed = this.layers.has(layerName);
      const layer = this.obtainLayer(map, tilesets, layerName);
      if (!layer) {
        continue;
      }
      if (!existed) {
        layer.setDepth(COLLISION_LAYER_DEPTH);
      }
      layer.setCollisionFromCollisionGroup(true, true);
      this.matter.world.convertTilemapLayer(layer, {
        isStatic: true,
        friction: 0,
        restitution: 0,
        label: `${layerName}-collider`,
      });
    }

    const topLayer = this.obtainLayer(map, tilesets, TOP_LAYER_NAME);
    if (topLayer) {
      topLayer.setDepth(TOP_LAYER_DEPTH);
    }
  }

  private resolveTilesetTextureKey(tileset: Phaser.Tilemaps.Tileset): string | undefined {
    const name = tileset.name;
    if (name && this.textures.exists(name)) {
      return name;
    }
    if (name && TILESET_RESOURCES[name]) {
      return name;
    }
    return Object.keys(TILESET_RESOURCES).find((key) => this.textures.exists(key));
  }

  private obtainLayer(
    map: Phaser.Tilemaps.Tilemap,
    tilesets: Phaser.Tilemaps.Tileset[],
    layerName: string,
  ): Phaser.Tilemaps.TilemapLayer | undefined {
    const existing = this.layers.get(layerName);
    if (existing) {
      return existing;
    }
    const created = map.createLayer(layerName, tilesets, 0, 0);
    if (created) {
      this.layers.set(layerName, created);
    }
    return created ?? undefined;
  }

  private spawnPlayer() {
    const spawn = this.resolvePlayerSpawnPoint();
    const player = this.matter.add.sprite(spawn.x, spawn.y, PLAYER_TEXTURE_KEY, undefined, {
      frictionAir: 0.35,
      ignoreGravity: true,
      label: 'player',
    });
    player.setDepth(PLAYER_DEPTH);
    player.setCircle(10);
    player.setFixedRotation();    player.setFriction(0, 0, 0);
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
    if (!this.player || !this.keys) return;
    let moveX = 0;
    let moveY = 0;
    if (this.keys.W.isDown) moveY -= 1;
    if (this.keys.S.isDown) moveY += 1;
    if (this.keys.A.isDown) moveX -= 1;
    if (this.keys.D.isDown) moveX += 1;

    this.player.setVelocity(0, 0);

    if (moveX || moveY) {
      const length = Math.hypot(moveX, moveY) || 1;
      const vx = (moveX / length) * PLAYER_SPEED;
      const vy = (moveY / length) * PLAYER_SPEED;
      this.player.setVelocity(vx, vy);
    }
  }

  private buildMerchant() {
    const routeLayer = this.map?.getObjectLayer('MerchantRoute');
    if (!routeLayer || !routeLayer.objects?.length) {
      return;
    }

    const routePoints = routeLayer.objects
      .filter((obj) => obj.point)
      .map((obj) => new Phaser.Math.Vector2(obj.x ?? 0, obj.y ?? 0));

    if (!routePoints.length) {
      return;
    }

    this.merchantRoute = { points: routePoints, index: routePoints.length > 1 ? 1 : 0 };
    const start = routePoints[0];
    const merchant = this.add.ellipse(start.x, start.y, 18, 18, 0xffc857);
    merchant.setStrokeStyle(2, 0x3d3d7a);
    merchant.setDepth(MERCHANT_DEPTH);
    this.merchant = merchant;
  }

  private updateMerchant(delta: number) {
    if (!this.merchant || this.merchantRoute.points.length === 0) {
      return;
    }

    const target = this.merchantRoute.points[this.merchantRoute.index];
    const step = MERCHANT_SPEED * (delta / 1000);
    const distance = Phaser.Math.Distance.Between(this.merchant.x, this.merchant.y, target.x, target.y);

    if (distance <= step) {
      this.merchant.setPosition(target.x, target.y);
      this.merchantRoute.index = (this.merchantRoute.index + 1) % this.merchantRoute.points.length;
    } else {
      const angle = Phaser.Math.Angle.Between(this.merchant.x, this.merchant.y, target.x, target.y);
      this.merchant.setPosition(
        this.merchant.x + Math.cos(angle) * step,
        this.merchant.y + Math.sin(angle) * step,
      );
    }
  }

  private renderCityMarkers() {
    const layer = this.map?.getObjectLayer('CityMarkers');
    if (!layer || !layer.objects?.length) {
      return;
    }

    for (const obj of layer.objects) {
      const x = obj.x ?? 0;
      const y = obj.y ?? 0;
      const pin = this.add.triangle(x, y, 0, 18, 9, 0, 18, 18, 0x7c5cff);
      pin.setDepth(CITY_MARKER_DEPTH);
      pin.setOrigin(0.5, 1);
      pin.setStrokeStyle(2, 0x2f2f52);
      this.cityMarkers.push(pin);

      const label = this.resolveObjectLabel(obj);
      if (label) {
        const text = this.add
          .text(x, y - 22, label, {
            fontSize: '12px',
            color: '#e6e8ef',
            strokeThickness: 2,
            stroke: '#1b1d30',
          })
          .setOrigin(0.5, 1)
          .setDepth(CITY_MARKER_DEPTH + 1);
        this.cityMarkers.push(text);
      }
    }
  }

  private resolveObjectLabel(obj: Phaser.Types.Tilemaps.TiledObject): string | undefined {
    const direct = (obj.name || '').trim();
    const propertyLabel = Array.isArray(obj.properties)
      ? (obj.properties as TiledProperty[]).find((entry) => entry.name === 'label')
      : undefined;
    if (propertyLabel && typeof propertyLabel.value === 'string') {
      const trimmed = propertyLabel.value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
    return direct || undefined;
  }

  private captureSpawnLayers() {
    this.enemySpawnAreas = this.extractPolygonLayer('EnemySpawnAreas');
    this.ogreSpawnAreas = this.extractPolygonLayer('OgreSpawnArea');
    this.wraithSpawnAreas = this.extractPolygonLayer('WraithSpawnArea');

    this.registry.set('enemySpawnAreas', this.enemySpawnAreas);
    this.registry.set('ogreSpawnAreas', this.ogreSpawnAreas);
    this.registry.set('wraithSpawnAreas', this.wraithSpawnAreas);
  }

  private extractPolygonLayer(layerName: string): Phaser.Math.Vector2[][] {
    const layer = this.map?.getObjectLayer(layerName);
    if (!layer || !layer.objects) {
      return [];
    }
    const polygons: Phaser.Math.Vector2[][] = [];
    for (const obj of layer.objects) {
      if (!obj.polygon || obj.polygon.length === 0) {
        continue;
      }
      const baseX = obj.x ?? 0;
      const baseY = obj.y ?? 0;
      const points = obj.polygon.map((point) => new Phaser.Math.Vector2(baseX + point.x, baseY + point.y));
      polygons.push(points);
    }
    return polygons;
  }

  private resolvePlayerSpawnPoint(): Phaser.Math.Vector2 {
    const layer = this.map?.getObjectLayer('SpawnPoints');
    if (!layer || !layer.objects || layer.objects.length === 0) {
      const width = this.map?.widthInPixels ?? 0;
      const height = this.map?.heightInPixels ?? 0;
      return new Phaser.Math.Vector2(width * 0.5, height * 0.5);
    }
    const spawn = layer.objects.find((obj) => obj.point) ?? layer.objects[0];
    return new Phaser.Math.Vector2(spawn.x ?? 0, spawn.y ?? 0);
  }
}
























