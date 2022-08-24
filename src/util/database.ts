import { RawManager, Song, SongData } from '../typings';
import { MongoClient, Db, Collection } from 'mongodb';

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

	public static get managers(): Collection<RawManager> {
		return this.database.collection('managers');
	}

	public static get starred(): Collection<SongData> {
		return this.database.collection('starred');
	}

	public static get cache(): Collection<SongData> {
		return this.database.collection('cache');
	}

	public static addSongToCache(data: SongData) {
		return Database.cache.updateOne(
			{
				id: data.id,
			},
			{
				$setOnInsert: {
					url: data.url,
					duration: data.duration,
					type: data.type,
					musixmatchId: data.musixmatchId,
					geniusId: data.geniusId,
				},
				$set: {
					title: data.title,
					artist: data.artist,
					thumbnail: data.thumbnail,
					live: data.live,
					format: data.format,
					related: data.related,
				},
			},
			{
				upsert: true,
			}
		);
	}
}
