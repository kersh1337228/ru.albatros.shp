import shp from 'shpjs';

interface ShapeGroup {
    shp: ArrayBuffer;
    dbf?: ArrayBuffer;
    prj?: ArrayBuffer;
    cpg?: ArrayBuffer;
    idx?: ArrayBuffer;
    shx?: ArrayBuffer;
}

interface Point  {
    type: 'Point';
    coordinates: vec2 | vec3;
}
interface LineString  {
    type: 'LineString';
    coordinates: vec2[] | vec3[];
    bbox: box2;
}
interface Polygon  {
    type: 'Polygon';
    coordinates: vec2[][] | vec3[][];
    bbox: box2;
}
interface MultiPoint {
    type: 'MultiPoint';
    coordinates: vec2[] | vec3[];
}
interface MultiLineString {
    type: 'MultiLineString';
    coordinates: vec2[][] | vec3[][];
}
interface MultiPolygon {
    type: 'MultiPolygon';
    coordinates: vec2[][][] | vec3[][][];
}
type Geometry = Point | LineString | Polygon | MultiPoint | MultiLineString | MultiPolygon;

type PropertyValue = number | string | boolean | Date;

interface Feature {
    type: 'Feature';
    geometry: Geometry;
    properties: Record<string, PropertyValue>;
}

interface FeatureCollection {
    type: 'FeatureCollection';
    features: Feature[];
}

type GeoJSON = FeatureCollection; // TODO: add other types

const ALLOWED_EXTENSIONS = ['shp', 'dbf', 'prj', 'cpg', 'idx', 'shx'];

async function addToGroups(groups: Record<string, ShapeGroup>, item: WorkspaceItem) {
    const bytes = await item.get();
    const title = item.title;
    const name = title.substring(0, title.length - 4);
    const extension = title.substring(title.length - 3) as keyof ShapeGroup;
    let group = groups[name];
    if (group === undefined) {
        group = {} as ShapeGroup;
        groups[name] = group;
    }
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
        console.error(`Unsupported extension ${extension}`);
        return;
    }
    group[extension] = bytes.buffer;
}

async function extractGroups(groups: Record<string, ShapeGroup>, items: WorkspaceItem[]): Promise<void> {
    for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        switch (item.mimeType) {
            case 'application/vnd.folder':
                await extractGroups(groups, await item.propfind());
                break;
            case 'application/octet-stream':
                await addToGroups(groups, item);
                break;
            default:
                console.error(`Unsupported MIME type ${item.mimeType}`);
        }
    }
}

function featurePropValue(prop: PropertyValue): DwgTypedObject {
    switch (typeof prop) {
        case 'number':
            return {
                $value: prop,
                $type: Number.isInteger(prop) ? 'int' : 'float',
                $units: undefined,
            };
        case 'string':
            return {
                $value: prop,
                $type: 'string',
            };
        case 'boolean':
            return {
                $value: prop,
                $type: 'bool',
            };
        default:
            if (prop instanceof Date) {
                return {
                    $value: prop.toLocaleString(),
                    $type: 'string',
                };
            } else {
                console.error(`Unsupported property type ${prop}`);
                return {
                    $value: prop
                }
            }
    }
}

function featureProps(rawProps: Record<string, PropertyValue>): DwgTypedObject {
    const props = {} as DwgTypedObject;
    for (const name in rawProps) {
        props[name] = featurePropValue(rawProps[name]);
    }
    return props;
}

function coordinatesToVec3(coordinates: vec2 | vec3): vec3 {
    return coordinates.length >= 3 ? [coordinates[0], coordinates[1], coordinates[2]] as vec3 : [coordinates[0], coordinates[1], 0] as vec3;
}

const SCALE = 1;
function scaleCoordinates(coordinates: vec3): vec3 {
    return coordinates.map(c => c * SCALE) as vec3;
}

async function featureGeometry(editor: DwgEntityEditor, layer: DwgLayer, rawGeometry: Geometry) {
    switch (rawGeometry.type) {
        case 'Point': {
            // TODO: add point primitive
            const entity = await editor.addCircle({
                center: scaleCoordinates(coordinatesToVec3(rawGeometry.coordinates)),
                radius: 0.005,
            });
            await entity.setx('$layer', layer);
            break;
        }
        case 'LineString': {
            let entity: DwgEntity | undefined;
            if (rawGeometry.coordinates.length === 2) {
                entity = await editor.addLine({
                    a: scaleCoordinates(coordinatesToVec3(rawGeometry.coordinates[0])),
                    b: scaleCoordinates(coordinatesToVec3(rawGeometry.coordinates[1])),
                });
            } else {
                entity = await editor.addPolyline3d({
                    vertices: rawGeometry.coordinates.map(p => scaleCoordinates(coordinatesToVec3(p))),
                    flags: undefined,
                });
            }
            await entity.setx('$layer', layer);
            break;
        }
        case 'Polygon': {
            // TODO: add as mesh (first vec3[] is polygon and the remaining ones are holes)
            for (let i = 0; i < rawGeometry.coordinates.length; ++i) {
                const coordinates = rawGeometry.coordinates[i];
                const entity = await editor.addPolyline3d({
                    vertices: coordinates.map(p => scaleCoordinates(coordinatesToVec3(p))),
                    flags: undefined,
                });
                await entity.setx('$layer', layer);
            }
            break;
        }
        case 'MultiPoint': {
            for (let i = 0; i < rawGeometry.coordinates.length; ++i) {
                const coordinates = rawGeometry.coordinates[i];
                const entity = await editor.addCircle({
                    center: scaleCoordinates(coordinatesToVec3(coordinates)),
                    radius: 0.005,
                });
                await entity.setx('$layer', layer);
            }
            break;
        }
        case 'MultiLineString': {
            for (let i = 0; i < rawGeometry.coordinates.length; ++i) {
                const coordinates = rawGeometry.coordinates[i];
                let entity: DwgEntity | undefined;
                if (coordinates.length === 2) {
                    entity = await editor.addLine({
                        a: scaleCoordinates(coordinatesToVec3(coordinates[0])),
                        b: scaleCoordinates(coordinatesToVec3(coordinates[1])),
                    });
                } else {
                    entity = await editor.addPolyline3d({
                        vertices: coordinates.map(p => scaleCoordinates(coordinatesToVec3(p))),
                        flags: undefined,
                    });
                }
                await entity.setx('$layer', layer);
            }
            break;
        }
        case 'MultiPolygon': {
            for (let i = 0; i < rawGeometry.coordinates.length; ++i) {
                const polygonCoordinates = rawGeometry.coordinates[i];
                for (let j = 0; j < polygonCoordinates.length; ++j) {
                    const coordinates = polygonCoordinates[j];
                    const entity = await editor.addPolyline3d({
                        vertices: coordinates.map(p => scaleCoordinates(coordinatesToVec3(p))),
                        flags: undefined,
                    });
                    await entity.setx('$layer', layer);
                }
            }
            break;
        }
        default:
            console.error(`Unsupported geometry type ${rawGeometry.type}`);
    }
}

async function loadFeature(editor: DwgEntityEditor, drawing: Drawing, feature: Feature): Promise<DwgLayer> {
    const layerData = featureProps(feature.properties);
    layerData.$type = drawing.types.itemById('SmdxElement');
    layerData.name = '';
    const layer = await drawing.layers.add(layerData as unknown as DwgLayerData);
    layer.disabled = true;
    await featureGeometry(editor, layer, feature.geometry);
    return layer;
}

async function loadShapes(editor: DwgEntityEditor, drawing: Drawing, groups: Record<string, ShapeGroup>) {
    for (const name in groups) {
        const group = groups[name];
        // @ts-expect-error | allowed argument type
        const geojson = await shp(group) as GeoJSON;
        switch (geojson.type) {
            case 'FeatureCollection': {
                const parent = await drawing.layers.add({
                    $type: drawing.types.itemById('SmdxElement'),
                    name,
                } as unknown as DwgLayerData);
                parent.disabled = true;
                const features = geojson.features;
                for (let i = 0; i < features.length; ++i) {
                    const feature = features[i];
                    switch (feature.type) {
                        case 'Feature': {
                            const layer = await loadFeature(editor, drawing, feature);
                            await layer.setx('$layer', parent);
                            break;
                        }
                        default:
                            console.error(`Unsupported feature type ${feature.type}`);
                            break;
                    }
                }
                break;
            }
            default:
                console.error(`Unsupported GeoJSON type ${geojson.type}`);
                break;
        }
    }
}

export default class SHPImporter implements WorkspaceImporter {
    constructor(private readonly context: Context) {}

    async import(workspace: Workspace, model: unknown): Promise<void> {
        const progress = this.context.beginProgress();
        const outputs = this.context.createOutputChannel('SHP');
        try { // TODO: use outputs instead of console.error
            outputs.info(this.context.tr('Импорт shape из {0}', workspace.origin ?? workspace.root.title));
            progress.indeterminate = true; // TODO: individual shapes progress
            const drawing = model as Drawing;
            const layout = drawing.layouts?.model;
            if (layout === undefined) {
                return;
            }
            progress.details = this.context.tr('Чтение файла');
            const items = await workspace.root.propfind();
            const groups = {} as Record<string, ShapeGroup>;
            await extractGroups(groups, items);
            const editor = layout.editor();
            await editor.beginEdit();
            try {
                await loadShapes(editor, drawing, groups);
            } finally {
                await editor.endEdit();
            }
        } catch (uncaughtException) {
            outputs.error(uncaughtException as Error);
        } finally {
            this.context.endProgress(progress);
        }
    }
}
