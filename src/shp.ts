import SHPImporter from './SHPImporter';

export default {
    'shp:importer': async (e: Context) => {
        return new SHPImporter(e);
    }
}
