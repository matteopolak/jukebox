import { Prisma } from '@prisma/client';
import axios, { AxiosInstance } from 'axios';

import { TrackProvider } from '@/structures/provider';
import { Result, SearchResult, TrackSource } from '@/typings/common';
import { prisma, TrackWithArtist } from '@/util/database';
import { bufferUnordered } from '@/util/promise';

const MAX_BATCH_SIZE_TRACK = 300;

export interface TrackData {
	id: string;
	attributes: {
		trackNumber: number;
		durationInMillis: number;
		artwork: {
			url: string;
		};
		name: string;
		artistName: string;
	};
}

export interface Album {
	id: string;
	attributes: {
		artwork: {
			url: string;
		};
		name: string;
		artistName: string;
		trackCount: number;
	};
	relationships: {
		tracks: Paginated<TrackData>;
	};
}

export interface Playlist {
	id: string;
	attributes: {
		artwork: {
			url: string;
		};
		name: string;
		trackCount: number;
	};
	relationships: {
		tracks: Paginated<TrackData>;
	};
}

export interface Paginated<T> {
	data: T[];
	next?: string;
}

export interface Response<T> {
	data: [T];
}

export class AppleProvider extends TrackProvider {
	private http: AxiosInstance;

	constructor() {
		super();

		this.http = axios.create({
			baseURL: 'https://amp-api.music.apple.com/v1',
			headers: {
				origin: 'https://music.apple.com',
				// use the default bearer token from the web player
				authorization: 'Bearer eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IldlYlBsYXlLaWQifQ.eyJpc3MiOiJBTVBXZWJQbGF5IiwiaWF0IjoxNjY4ODAwNDE0LCJleHAiOjE2NzYwNTgwMTQsInJvb3RfaHR0cHNfb3JpZ2luIjpbImFwcGxlLmNvbSJdfQ.lU7UBXnRH7LGMnCu2q9x99yBTE0OAHRtzA1h31eyrzlOl8W-1JDxnk74GnRoXxmnRpyYebGCNtt3bphRHQ-mEg',
			},
		});
	}

	public static trackDataToTrack(track: TrackData): Prisma.PrismaPromise<TrackWithArtist> {
		const trackId = `apple:track:${track.id}`;
		const artistId = `apple:artist:${track.attributes.artistName}`;

		return prisma.track.upsert({
			where: {
				uid: trackId,
			},
			update: {
				title: track.attributes.name,
			},
			create: {
				uid: trackId,
				title: track.attributes.name,
				artist: {
					connectOrCreate: {
						where: {
							uid: artistId,
						},
						create: {
							uid: artistId,
							name: track.attributes.artistName,
						},
					},
				},
				duration: track.attributes.durationInMillis,
				thumbnail: track.attributes.artwork.url.replace('{w}', '500').replace('{h}', '500'),
				source: TrackSource.Apple,
				relatedCount: 0,
			},
			include: {
				artist: true,
			},
		});
	}

	private async _getTracks(type: string, id: string, catalog: string, batches: number, start = 0) {
		const tracks: TrackData[] = [];

		await bufferUnordered(Array.from({ length: batches }, () => undefined), async (_, index) => {
			const response = await this.http.get<Paginated<TrackData>>(`/catalog/${catalog}/${type}/${id}/tracks`, {
				params: {
					limit: MAX_BATCH_SIZE_TRACK,
					offset: start + index * MAX_BATCH_SIZE_TRACK,
				},
			});

			tracks.push(...response.data.data);
		});

		return tracks;
	}

	private async _getTracksPaginated(next?: string) {
		const tracks: TrackData[] = [];

		while (next) {
			const response = await this.http.get<Paginated<TrackData>>(next, {
				baseURL: 'https://amp-api.music.apple.com',
			});
			tracks.push(...response.data.data);

			next = response.data.next;
		}

		return tracks;
	}

	public async getAlbum(id: string, catalog = 'us'): Promise<Result<SearchResult>> {
		const response = await this.http.get<Response<Album>>(`/catalog/${catalog}/albums/${id}`);
		if (response.status !== 200) return { ok: false, error: `An album with the id \`${id}\` does not exist.` };

		const album = response.data.data[0];
		if (!album) return { ok: false, error: `An album with the id \`${id}\` does not exist.` };

		const tracks = await this._getTracks(
			'albums',
			id,
			catalog,
			Math.ceil(album.attributes.trackCount / MAX_BATCH_SIZE_TRACK) - 1,
			MAX_BATCH_SIZE_TRACK
		);

		tracks.unshift(...album.relationships.tracks.data);

		return {
			ok: true,
			value: {
				title: album.attributes.name,
				tracks: await prisma.$transaction(tracks.map(AppleProvider.trackDataToTrack)),
			},
		};
	}

	public async getPlaylist(id: string, catalog = 'us'): Promise<Result<SearchResult>> {
		const response = await this.http.get<Response<Playlist>>(`/catalog/${catalog}/playlists/${id}`);
		if (response.status !== 200) return { ok: false, error: `A playlist with the id \`${id}\` does not exist.` };

		const playlist = response.data.data[0];
		if (!playlist) return { ok: false, error: `A playlist with the id \`${id}\` does not exist.` };

		const tracks = await this._getTracksPaginated(playlist.relationships.tracks.next);
		tracks.unshift(...playlist.relationships.tracks.data);

		return {
			ok: true,
			value: {
				title: playlist.attributes.name,
				tracks: await prisma.$transaction(tracks.map(AppleProvider.trackDataToTrack)),
			},
		};
	}
}
