import axios, { AxiosInstance } from 'axios';
import ytdl, { videoInfo as VideoInfo } from 'ytdl-core';

import { Provider, SearchOptions, SearchType } from '@/structures/Provider';
import { Option, ProviderOrigin, Result, SearchResult, SongData } from '@/typings/common';
import { Database } from '@/util/database';
import { parseDurationString } from '@/util/duration';
import { getCachedSong } from '@/util/search';

export type SearchItem<T extends SearchType> = T extends SearchType.Playlist ? PlaylistItem : T extends SearchType.Video ? VideoItem : never;

export const SEARCH_TYPE_TO_KEY: Record<SearchType, string> = {
	[SearchType.Video]: 'videoRenderer',
	[SearchType.Playlist]: 'playlistRenderer',
};

export interface PlaylistItem {
	playlistRenderer: {
		playlistId: string;
		title: {
			simpleText: string;
		};
		videoCount: string;
	}
}

export interface VideoItem {
	videoRenderer: {
		videoId: string;
		// video title
		title: Run<Text>;
		// video author
		ownerText: Run<Text>;
		// video duration as `00:00:00` or `00:00`
		lengthText: SimpleText;
		// video views as `24,000 views`
		viewCountText: SimpleText;
	}
}

export interface SimpleText {
	simpleText: string;
}

export interface Text {
	text: string;
}

export interface Run<T> {
	runs: T[];
}

export interface SearchResponse<T extends SearchType> {
	contents: {
		twoColumnSearchResultsRenderer: {
			primaryContents: {
				sectionListRenderer: {
					contents: [
						{
							itemSectionRenderer: {
								contents: SearchItem<T>[];
							}
						}
					]
				}
			}
		}
	}
}

export interface InitialData {
	contents: Contents;
	metadata: Metadata;
	onResponseReceivedActions: OnResponseReceivedAction[];
}

interface ContentContainer<T> {
	contents: T[];
}

interface RunContainer<T> {
	runs: T[]
}

interface OnResponseReceivedAction {
	appendContinuationItemsAction: {
		continuationItems: PlaylistVideoListRendererContent[];
	}
}

interface Contents {
	twoColumnBrowseResultsRenderer: {
		tabs: Tab[];
	};
}

interface Tab {
	tabRenderer: {
		content: {
			sectionListRenderer: ContentContainer<SectionListRendererContent>
		};
	};
}

interface SectionListRendererContent {
	itemSectionRenderer: ContentContainer<ItemSectionRendererContent>;
}

interface ItemSectionRendererContent {
	playlistVideoListRenderer: ContentContainer<PlaylistVideoListRendererContent>;
}

interface PlaylistVideoListRendererContent {
	playlistVideoRenderer?: PlaylistVideoRenderer;
	continuationItemRenderer?: ContinuationItemRenderer;
}

interface ContinuationItemRenderer {
	continuationEndpoint: {
		continuationCommand: {
			token: string;
		};
	};
}

interface PlaylistVideoRenderer {
	videoId: string;
	title: RunContainer<Text>;
	shortBylineText: RunContainer<Text>;
	lengthSeconds: string;
	isPlayable: boolean;
}

export interface Metadata {
	playlistMetadataRenderer: {
		title: string;
		description: string;
	};
}

export class YouTubeProvider extends Provider {
	private cookie?: string | undefined;
	private http: AxiosInstance;

	private static INITIAL_DATA_REGEX = /var ytInitialData = (?=\{)(.*)(?<=\});</;
	private static YOUTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
	public static ID_REGEX = /^[\w-]{11}$/;

	constructor(cookie?: string) {
		super();

		this.cookie = cookie;
		// @ts-expect-error - explicit undefined is allowed here
		this.http = axios.create({
			baseURL: 'https://www.youtube.com',
			params: {
				key: YouTubeProvider.YOUTUBE_API_KEY,
			},
			headers: this.cookie ? {
				cookie: this.cookie,
			} : undefined,
			validateStatus: () => true,
		});
	}

	public static itemToSong(item: VideoItem): SongData {
		return {
			id: item.videoRenderer.videoId,
			uid: item.videoRenderer.videoId,
			title: item.videoRenderer.title.runs[0].text,
			url: `https://www.youtube.com/watch?v=${item.videoRenderer.videoId}`,
			thumbnail: `https://i.ytimg.com/vi/${item.videoRenderer.videoId}/hqdefault.jpg`,
			artist: item.videoRenderer.ownerText.runs[0].text,
			live: false,
			duration: parseDurationString(item.videoRenderer.lengthText.simpleText),
			type: ProviderOrigin.YouTube,
		};
	}

	public async getTrack(id: string): Promise<Result<SearchResult, string>> {
		const cached = await getCachedSong(id);
		if (cached) {
			// Remove the unique id
			// @ts-expect-error - _id is not a property of SongData
			cached._id = undefined;

			return {
				ok: true,
				value: {
					videos: [cached],
					title: undefined,
				},
			};
		}

		try {
			const data = YouTubeProvider.videoInfoToSongData(
				await ytdl.getBasicInfo(`https://www.youtube.com/watch?v=${id}`, {
					requestOptions: {
						headers: {
							Cookie: this.cookie,
						},
					},
				})
			);

			await Database.addSongToCache(data);

			return {
				ok: true,
				value: {
					videos: [data],
					title: undefined,
				},
			};
		} catch {
			return {
				ok: false,
				error: `A YouTube video by the id of \`${id}\` does not exist.`,
			};
		}
	}

	public async search(query: string, filter: SearchOptions): Promise<Result<SearchResult, string>> {
		if (filter.type === SearchType.Video) {
			return this._searchVideo(query, filter);
		}

		return this._searchPlaylist(query, filter);
	}

	public async getPlaylist(id: string): Promise<Result<SearchResult, string>> {
		const { data: html } = await axios.get<string>(`https://www.youtube.com/playlist?list=${id}`);

		const dataString = html.match(YouTubeProvider.INITIAL_DATA_REGEX)?.[1];
		if (!dataString) return { ok: false, error: `Could not find playlist data from the YouTube playlist \`${id}\`.` };

		const [data, metadata] = YouTubeProvider.parseInitialData(dataString);
		if (!data) return { ok: false, error: `Could not parse playlist data from the YouTube playlist \`${id}\`.` };

		const videos = data[1];
		let continuationToken = data[0];

		while (continuationToken) {
			const { data } = await axios.post<InitialData>('https://www.youtube.com/youtubei/v1/browse', {
				context: {
					client: {
						clientName: 'WEB',
						clientVersion: '2.20221130.04.00',
					},
				},
				continuation: continuationToken,
			}, {
				params: {
					key: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
				},
			});

			const [token, parsedVideos] = YouTubeProvider.parsePlaylist(data);

			continuationToken = token;
			videos.push(...parsedVideos);
		}

		return {
			ok: true,
			value: {
				title: metadata?.playlistMetadataRenderer?.title,
				videos,
			},
		};
	}

	private async _searchVideo(query: string, _filter: SearchOptions): Promise<Result<SearchResult, string>> {
		const videos = await this._search(query, SearchType.Video);
		if (!videos?.length) return { ok: false, error: `No videos found with the query \`${query}\`.` };

		return this.getTrack(videos[0].videoRenderer.videoId);
	}

	private async _searchPlaylist(query: string, _filter: SearchOptions): Promise<Result<SearchResult, string>> {
		const playlists = await this._search(query, SearchType.Playlist);
		if (!playlists) return { ok: false, error: `No playlists found with the query \`${query}\`.` };

		return this.getPlaylist(playlists[0].playlistRenderer.playlistId);
	}

	private async _search<T extends SearchType>(query: string, type: T): Promise<Option<SearchItem<T>[]>> {
		const response = await this.http.post<SearchResponse<T>>('/youtubei/v1/search', {
			context: {
				client: {
					clientName: 'WEB',
					clientVersion: '2.20221130.04.00',
				},
			},
			params: type,
			query,
		});

		if (response.status !== 200) return undefined;

		const items = response.data.contents
			?.twoColumnSearchResultsRenderer?.primaryContents
			?.sectionListRenderer?.contents
			?.flatMap((section) => section.itemSectionRenderer
				?.contents?.filter(s => SEARCH_TYPE_TO_KEY[type] in s) ?? []
			);

		return items?.length ? items : undefined;
	}

	private static parseInitialData(initialData: string): [[undefined, SongData[]], undefined] | [[Option<string>, SongData[]], Metadata] {
		try {
			const data: InitialData = JSON.parse(initialData);

			const playlist = data.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer?.contents;
			if (!playlist) return [[undefined, []], undefined];

			const continuationToken = playlist.at(-1)?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
			if (continuationToken) playlist.pop();

			const videos = playlist.map(video => {
				const info = video.playlistVideoRenderer!;

				return {
					id: info.videoId,
					uid: info.videoId,
					title: info.title.runs[0].text,
					url: `https://www.youtube.com/watch?v=${info.videoId}`,
					thumbnail: `https://i.ytimg.com/vi/${info.videoId}/hqdefault.jpg`,
					duration: parseInt(info.lengthSeconds) * 1_000,
					artist: info.shortBylineText.runs[0].text,
					live: false,
					type: ProviderOrigin.YouTube,
				} satisfies SongData as SongData;
			});

			return [[continuationToken, videos], data.metadata];
		} catch (e) {
			return [[undefined, []], undefined];
		}
	}

	private static parsePlaylist(data: InitialData): [Option<string>, SongData[]] {
		const playlist = data?.onResponseReceivedActions?.[0]?.appendContinuationItemsAction?.continuationItems;
		if (!playlist) return [undefined, []];

		const continuationToken = playlist.at(-1)?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
		if (continuationToken) playlist.pop();

		const videos = playlist.map(video => {
			const info = video.playlistVideoRenderer!;

			return {
				id: info.videoId,
				uid: info.videoId,
				title: info.title.runs[0].text,
				url: `https://www.youtube.com/watch?v=${info.videoId}`,
				thumbnail: `https://i.ytimg.com/vi/${info.videoId}/hqdefault.jpg`,
				duration: parseInt(info.lengthSeconds) * 1_000,
				artist: info.shortBylineText.runs[0].text,
				live: false,
				type: ProviderOrigin.YouTube,
			} satisfies SongData as SongData;
		});

		return [continuationToken, videos];
	}

	private static videoInfoToSongData(data: VideoInfo): SongData {
		const info = data.videoDetails;
		const related = data.related_videos.filter(v => v?.id);

		const song = {
			id: info.videoId,
			uid: info.videoId,
			url: info.video_url,
			title: info.title,
			artist: // prettier-ignore
			// @ts-expect-error - ytdl doesn't have a type for author but it exists
			(data.response?.contents?.twoColumnWatchNextResults?.results?.results?.contents?.find(
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(c: any) => c.videoSecondaryInfoRenderer
			)?.videoSecondaryInfoRenderer?.owner?.videoOwnerRenderer?.title.runs[0]
				?.text ?? data.videoDetails.author.name).replace(
				' - Topic',
				''
			),
			thumbnail: `https://i.ytimg.com/vi/${info.videoId}/hqdefault.jpg`,
			duration: parseInt(info.lengthSeconds) * 1_000,
			live: info.isLiveContent,
			type: ProviderOrigin.YouTube,
		} satisfies SongData as SongData;

		if (related.length) {
			song.related = related.map(v => v.id!);
		}

		const metadata =
			// @ts-expect-error - ytdl does not have a typescript definition for this
			data.response?.engagementPanels
				.find(
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					(i: any) =>
						i.engagementPanelSectionListRenderer?.header
							?.engagementPanelTitleHeaderRenderer?.title?.simpleText ===
						'Description'
				)
				?.engagementPanelSectionListRenderer.content.structuredDescriptionContentRenderer.items.find(
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					(i: any) =>
						i?.videoDescriptionMusicSectionRenderer?.sectionTitle?.simpleText ===
						'Music'
				);

		if (metadata) {
			for (const item of metadata.videoDescriptionMusicSectionRenderer
				?.carouselLockups[0]?.carouselLockupRenderer?.infoRows ?? []) {
				const content =
					item.infoRowRenderer?.defaultMetadata?.simpleText ??
					item.infoRowRenderer?.expandedMetadata?.simpleText ??
					item.infoRowRenderer?.defaultMetadata?.runs[0]?.text;

				switch (item.infoRowRenderer.title.simpleText) {
					case 'SONG':
						song.title = content;

						break;
					case 'ARTIST':
						song.artist = content;

						break;
				}
			}
		}

		return song;
	}
}
