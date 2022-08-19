import Datastore from 'nedb-promises';
import { RawManager, Song, SongData, StarredData, WithId } from '../typings';

export const queue: Datastore<WithId<Song>> = Datastore.create({
	autoload: true,
	filename: './data/queue.db',
});

export const managers: Datastore<WithId<RawManager>> = Datastore.create({
	filename: './data/managers.db',
	autoload: true,
});

export const starred: Datastore<WithId<SongData>> = Datastore.create({
	filename: './data/starred.db',
	autoload: true,
});

export const songDataCache: Datastore<WithId<SongData>> = Datastore.create({
	filename: './data/song_cache.db',
});

songDataCache.ensureIndex({
	fieldName: 'id',
	unique: true,
	sparse: true,
});
