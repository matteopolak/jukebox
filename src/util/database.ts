import { Manager, Song, SongData } from '@/typings/common';
import { MongoClient, Db, Collection, UpdateFilter } from 'mongodb';

export class Database {
	public static client: MongoClient;
	public static database: Db;

	public static async login() {
		this.client = await MongoClient.connect(process.env.MONGODB_URI!);
		this.database = this.client.db('music');

		return Promise.all([
			this.database.collection('cache').createIndex({ id: 'text' }),
			this.database.collection('queue').createIndex({ id: 'text' }),
			this.database.collection('queue').createIndex({ addedAt: 1 }),
			this.database.collection('managers').createIndex({ channelId: 'text' }),
		]);
	}

	public static get queue(): Collection<Song> {
		return this.database.collection('queue');
	}

	public static get managers(): Collection<Manager> {
		return this.database.collection('managers');
	}

	public static get cache(): Collection<SongData> {
		return this.database.collection('cache');
	}

	public static addSongToCache(data: SongData) {
		const payload: Record<'$setOnInsert' | '$set', Record<string, unknown>> = {
			$setOnInsert: {
				url: data.url,
				duration: data.duration,
				type: data.type,
			},
			$set: {
				title: data.title,
				artist: data.artist,
				thumbnail: data.thumbnail,
				live: data.live,
			},
		};

		if (data.musixmatchId) {
			payload.$setOnInsert.musixmatchId = data.musixmatchId;
		}

		if (data.geniusId) {
			payload.$setOnInsert.geniusId = data.geniusId;
		}

		if (data.format) {
			payload.$set.format = data.format;
		}

		if (data.related) {
			payload.$set.related = data.related;
		}

		return Database.cache.updateOne(
			{
				id: data.id,
			},
			payload as UpdateFilter<SongData>,
			{
				upsert: true,
			}
		);
	}

	public static addSongsToCache(data: SongData[]) {
		return Promise.all(data.map(Database.addSongToCache));
	}
}
