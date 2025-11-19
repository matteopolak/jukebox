import { Innertube, UniversalCache, YTNodes } from 'youtubei.js';
import { Prisma } from '@prisma/client';

import { SearchOptions, SearchType, TrackProvider } from '@/structures/provider';
import { Result, SearchResult, TrackSource } from '@/typings/common';
import { prisma, TrackWithArtist } from '@/util/database';
import { parseDurationString } from '@/util/duration';
import { getCachedTrack, trackToOkSearchResult } from '@/util/search';

export interface VideoItem {
	videoRenderer: {
		videoId: string;
		title: Run<Text>;
		ownerText: Run<Text>;
		lengthText: SimpleText;
		viewCountText: SimpleText;
	}
}

export interface SimpleText {
	simpleText: string;
}

export interface Text {
	text: string;
	navigationEndpoint: {
		browseEndpoint: {
			browseId: string;
		}
	}
}

export interface Run<T> {
	runs: T[];
}

export class YouTubeProvider extends TrackProvider {
	private innertube: Innertube | null = null;
	private cookie?: string;

	public static ID_REGEX = /^[\w-]{11}$/;

	constructor(cookie?: string) {
		super();
		this.cookie = cookie;
	}

	private async getInnertube(): Promise<Innertube> {
		if (!this.innertube) {
			this.innertube = await Innertube.create({
				cache: new UniversalCache(false),
				generate_session_locally: true,
				cookie: this.cookie,
			});
		}
		return this.innertube;
	}

	public static async itemToTrack(item: VideoItem): Promise<TrackWithArtist> {
		const trackId = `youtube:track:${item.videoRenderer.videoId}`;
		const artistId = `youtube:artist:${item.videoRenderer.ownerText.runs[0].navigationEndpoint.browseEndpoint.browseId}`;

		return prisma.track.upsert({
			where: {
				uid: trackId,
			},
			update: {
				title: item.videoRenderer.title.runs[0].text,
				source: TrackSource.YouTube,
			},
			create: {
				uid: trackId,
				title: item.videoRenderer.title.runs[0].text,
				thumbnail: `https://i.ytimg.com/vi/${item.videoRenderer.videoId}/hqdefault.jpg`,
				artist: {
					connectOrCreate: {
						where: {
							uid: artistId,
						},
						create: {
							name: item.videoRenderer.ownerText.runs[0].text,
							uid: artistId,
						},
					},
				},
				relatedCount: 0,
				duration: parseDurationString(item.videoRenderer.lengthText.simpleText),
				source: TrackSource.YouTube,
				url: `https://www.youtube.com/watch?v=${item.videoRenderer.videoId}`,
			},
			include: {
				artist: true,
			},
		});
	}

	private static async videoInfoToTrack(videoId: string, innertube: Innertube): Promise<TrackWithArtist> {
		const cached = await getCachedTrack(`youtube:track:${videoId}`);
		if (cached) return cached;

		const info = await innertube.getInfo(videoId);
		const basic = info.basic_info;

		// Get related videos from the watch next feed
		const related = info.watch_next_feed
			?.filter((item): item is YTNodes.CompactVideo => item.type === 'CompactVideo')
			.map(item => `youtube:track:${item.id}`)
			.filter((id): id is string => !!id) ?? [];

		const trackId = `youtube:track:${videoId}`;
		const artistId = `youtube:artist:${basic.channel_id}`;
		const authorName = basic.author?.replace(' - Topic', '') ?? 'Unknown';

		const track: Prisma.TrackCreateInput = {
			uid: trackId,
			url: `https://www.youtube.com/watch?v=${videoId}`,
			title: basic.title ?? 'Unknown',
			artist: {
				connectOrCreate: {
					where: {
						uid: artistId,
					},
					create: {
						name: authorName,
						uid: artistId,
					},
				},
			},
			thumbnail: basic.thumbnail?.[0]?.url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
			duration: (basic.duration ?? 0) * 1_000,
			source: TrackSource.YouTube,
			related: related.length > 0 ? related : undefined,
			relatedCount: related.length,
		};

		return prisma.track.upsert({
			where: {
				uid: track.uid,
			},
			update: {
				relatedCount: track.relatedCount,
				related: track.related,
				title: track.title,
			},
			create: track,
			include: {
				artist: true,
			},
		});
	} public async getTrack(id: string): Promise<Result<SearchResult>> {
		const cached = await getCachedTrack(`youtube:track:${id}`);
		if (cached) return trackToOkSearchResult(cached);

		try {
			const innertube = await this.getInnertube();
			const track = await YouTubeProvider.videoInfoToTrack(id, innertube);

			return trackToOkSearchResult(track);
		} catch {
			return {
				ok: false,
				error: `A YouTube video by the id of \`${id}\` does not exist.`,
			};
		}
	}

	public async search(query: string, filter: SearchOptions): Promise<Result<SearchResult>> {
		if (filter.type === SearchType.Video) {
			return this._searchVideo(query, filter);
		}

		return this._searchPlaylist(query, filter);
	}

	public async getPlaylist(id: string): Promise<Result<SearchResult>> {
		try {
			const innertube = await this.getInnertube();
			const playlist = await innertube.getPlaylist(id);

			if (!playlist || !playlist.items) {
				return { ok: false, error: `Could not find playlist data from the YouTube playlist \`${id}\`.` };
			}

			const trackData: Prisma.TrackUpsertArgs[] = [];

			for (const item of playlist.items) {
				// Filter for PlaylistVideo items only
				if (item.type !== 'PlaylistVideo') continue;

				const videoId = (item as YTNodes.PlaylistVideo).id;
				if (!videoId) continue;

				const playlistVideo = item as YTNodes.PlaylistVideo;
				const title = playlistVideo.title?.toString() ?? 'Unknown';
				const duration = playlistVideo.duration?.seconds ? playlistVideo.duration.seconds * 1_000 : 0;
				const authorName = playlistVideo.author?.name ?? 'Unknown';
				const channelId = playlistVideo.author?.id ?? 'unknown';

				const trackId = `youtube:track:${videoId}`;
				const artistId = `youtube:artist:${channelId}`;

				trackData.push({
					where: {
						uid: trackId,
					},
					update: {
						title,
					},
					create: {
						uid: trackId,
						title,
						url: `https://www.youtube.com/watch?v=${videoId}`,
						thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
						duration,
						artist: {
							connectOrCreate: {
								where: {
									uid: artistId,
								},
								create: {
									name: authorName,
									uid: artistId,
								},
							},
						},
						source: TrackSource.YouTube,
						relatedCount: 0,
					},
				});
			}

			const tracks = await prisma.$transaction(trackData.map(t => prisma.track.upsert(t)));

			return {
				ok: true,
				value: {
					title: playlist.info.title ?? null,
					tracks,
				},
			};
		} catch (error) {
			return { ok: false, error: `Failed to fetch playlist \`${id}\`: ${error}` };
		}
	}

	private async _searchVideo(query: string, _filter: SearchOptions): Promise<Result<SearchResult>> {
		try {
			const innertube = await this.getInnertube();
			const search = await innertube.search(query, { type: 'video' });

			const videos = search.results.filter(item => item.type === 'Video');
			if (!videos.length) return { ok: false, error: `No videos found with the query \`${query}\`.` };

			const firstVideo = videos[0] as YTNodes.Video;
			return this.getTrack(firstVideo.id);
		} catch (error) {
			return { ok: false, error: `Search failed: ${error}` };
		}
	}

	private async _searchPlaylist(query: string, _filter: SearchOptions): Promise<Result<SearchResult>> {
		try {
			const innertube = await this.getInnertube();
			const search = await innertube.search(query, { type: 'playlist' });

			const playlists = search.results.filter(item => item.type === 'Playlist');
			if (!playlists.length) return { ok: false, error: `No playlists found with the query \`${query}\`.` };

			const firstPlaylist = playlists[0] as YTNodes.Playlist;
			return this.getPlaylist(firstPlaylist.id);
		} catch (error) {
			return { ok: false, error: `Search failed: ${error}` };
		}
	}
}
