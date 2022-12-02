import { Option, SearchResult, SongData, SongProvider } from '@/typings/common';
import axios from 'axios';
import ytdl, { videoInfo } from 'ytdl-core';

import { Database } from '@/util/database';
import { randomInteger } from '@/util/random';
import { getCachedSong } from '@/util/search';

const INITIAL_DATA_REGEX = /var ytInitialData = (?=\{)(.*)(?<=\});/;

export interface InitialData {
	contents: Contents;
	metadata: Metadata;
}

interface Metadata {
	playlistMetadataRenderer: PlaylistMetadataRenderer;
}

interface PlaylistMetadataRenderer {
	title: string;
	description: string;
}

interface VoiceSearchDialogRenderer {
	placeholderHeader: DescriptionTapText;
	promptHeader: DescriptionTapText;
	exampleQuery1: DescriptionTapText;
	exampleQuery2: DescriptionTapText;
	promptMicrophoneLabel: DescriptionTapText;
	loadingHeader: DescriptionTapText;
	connectionErrorHeader: DescriptionTapText;
	connectionErrorMicrophoneLabel: DescriptionTapText;
	permissionsHeader: DescriptionTapText;
	permissionsSubtext: DescriptionTapText;
	disabledHeader: DescriptionTapText;
	disabledSubtext: DescriptionTapText;
	microphoneButtonAriaLabel: DescriptionTapText;
	exitButton: ShareButtonClass;
	trackingParams: string;
	microphoneOffPromptHeader: DescriptionTapText;
}

interface FluffyPopup {
	voiceSearchDialogRenderer: VoiceSearchDialogRenderer;
}

interface PurpleOpenPopupAction {
	popup: FluffyPopup;
	popupType: string;
}

interface PurpleAction {
	clickTrackingParams: string;
	openPopupAction: PurpleOpenPopupAction;
}

interface PurpleSignalServiceEndpoint {
	signal: Signal;
	actions: PurpleAction[];
}

interface ButtonRendererServiceEndpoint {
	clickTrackingParams: string;
	commandMetadata: ContinuationEndpointCommandMetadata;
	shareEntityServiceEndpoint?: ShareEntityServiceEndpoint;
	signalServiceEndpoint?: PurpleSignalServiceEndpoint;
}

interface ShareButtonButtonRenderer {
	style: string;
	size: string;
	isDisabled: boolean;
	icon: Icon;
	trackingParams: string;
	accessibilityData?: ToggledAccessibilityDataClass;
	serviceEndpoint?: ButtonRendererServiceEndpoint;
	tooltip?: string;
	navigationEndpoint?: PurpleNavigationEndpoint;
	accessibility?: AccessibilityAccessibility;
}

interface ShareButtonClass {
	buttonRenderer: ShareButtonButtonRenderer;
}

interface DescriptionTapText {
	runs: DescriptionTapTextRun[];
}

interface DescriptionTapTextRun {
	text: string;
}

enum Signal {
	ClientSignal = 'CLIENT_SIGNAL',
}

interface ContinuationEndpointCommandMetadata {
	webCommandMetadata: FluffyWebCommandMetadata;
}

interface FluffyWebCommandMetadata {
	sendPost: boolean;
	apiUrl?: APIURL;
}

enum APIURL {
	YoutubeiV1AccountAccountMenu = '/youtubei/v1/account/account_menu',
	YoutubeiV1Browse = '/youtubei/v1/browse',
	YoutubeiV1BrowseEditPlaylist = '/youtubei/v1/browse/edit_playlist',
	YoutubeiV1PlaylistCreate = '/youtubei/v1/playlist/create',
	YoutubeiV1ShareGetSharePanel = '/youtubei/v1/share/get_share_panel',
}

interface ShareEntityServiceEndpoint {
	serializedShareEntity: string;
	commands: CommandElement[];
}

interface CommandElement {
	clickTrackingParams: string;
	openPopupAction: CommandOpenPopupAction;
}

interface CommandOpenPopupAction {
	popup: PurplePopup;
	popupType: string;
	beReused: boolean;
}

interface PurplePopup {
	unifiedSharePanelRenderer: UnifiedSharePanelRenderer;
}

interface UnifiedSharePanelRenderer {
	trackingParams: string;
	showLoadingSpinner: boolean;
}

interface AccessibilityAccessibility {
	label: string;
}

interface ToggledAccessibilityDataClass {
	accessibilityData: AccessibilityAccessibility;
}

interface Icon {
	iconType: string;
}

interface PurpleNavigationEndpoint {
	clickTrackingParams: string;
	commandMetadata: OwnerEndpointCommandMetadata;
	watchEndpoint: PurpleWatchEndpoint;
}

interface OwnerEndpointCommandMetadata {
	webCommandMetadata: PurpleWebCommandMetadata;
}

interface PurpleWebCommandMetadata {
	url?: string;
	webPageType?: WebPageType;
	rootVe?: number;
	apiUrl?: APIURL;
	ignoreNavigation?: boolean;
}

enum WebPageType {
	WebPageTypeBrowse = 'WEB_PAGE_TYPE_BROWSE',
	WebPageTypeChannel = 'WEB_PAGE_TYPE_CHANNEL',
	WebPageTypePlaylist = 'WEB_PAGE_TYPE_PLAYLIST',
	WebPageTypeSearch = 'WEB_PAGE_TYPE_SEARCH',
	WebPageTypeUnknown = 'WEB_PAGE_TYPE_UNKNOWN',
	WebPageTypeWatch = 'WEB_PAGE_TYPE_WATCH',
}

interface PurpleWatchEndpoint {
	videoId: string;
	playlistId: TID;
	params: string;
	loggingContext: LoggingContext;
	watchEndpointSupportedOnesieConfig: WatchEndpointSupportedOnesieConfig;
}

interface LoggingContext {
	vssLoggingContext: VssLoggingContext;
}

interface VssLoggingContext {
	serializedContextData: SerializedContextData;
}

enum SerializedContextData {
	GiJQTGdEUDVVS0XXYUNBX2NKZULKQmNWTGJMRmlkNDLBTVFo = 'GiJQTGdEUDVVS0xXYUNBX2NKZUlKQmNWTGJMRmlkNDlBTVFo',
}

enum TID {
	PLgDP5UKLWaCACJeIJBcVLBLFid49AMQh = 'PLgDP5UKLWaCA_cJeIJBcVLbLFid49AMQh',
}

interface WatchEndpointSupportedOnesieConfig {
	html5PlaybackOnesieConfig: Html5PlaybackOnesieConfig;
}

interface Html5PlaybackOnesieConfig {
	commonConfig: CommonConfig;
}

interface CommonConfig {
	url: string;
}

interface DescriptionText {
	simpleText: string;
}

interface Contents {
	twoColumnBrowseResultsRenderer: TwoColumnBrowseResultsRenderer;
}

interface TwoColumnBrowseResultsRenderer {
	tabs: Tab[];
}

interface Tab {
	tabRenderer: TabRenderer;
}

interface TabRenderer {
	selected: boolean;
	content: TabRendererContent;
	trackingParams: string;
}

interface TabRendererContent {
	sectionListRenderer: SectionListRenderer;
}

interface SectionListRenderer {
	contents: SectionListRendererContent[];
	trackingParams: string;
}

interface SectionListRendererContent {
	itemSectionRenderer: ItemSectionRenderer;
}

interface ItemSectionRenderer {
	contents: ItemSectionRendererContent[];
	trackingParams: string;
}

interface ItemSectionRendererContent {
	playlistVideoListRenderer: PlaylistVideoListRenderer;
}

interface PlaylistVideoListRenderer {
	contents: PlaylistVideoListRendererContent[];
	playlistId: TID;
	isEditable: boolean;
	canReorder: boolean;
	trackingParams: string;
	targetId: TID;
}

interface PlaylistVideoListRendererContent {
	playlistVideoRenderer?: PlaylistVideoRenderer;
	continuationItemRenderer?: ContinuationItemRenderer;
}

interface ContinuationItemRenderer {
	trigger: string;
	continuationEndpoint: ContinuationEndpoint;
}

interface ContinuationEndpoint {
	clickTrackingParams: string;
	commandMetadata: ContinuationEndpointCommandMetadata;
	continuationCommand: ContinuationCommand;
}

interface ContinuationCommand {
	token: string;
	request: string;
}

interface PlaylistVideoRenderer {
	videoId: string;
	thumbnail: PlaylistVideoRendererThumbnail;
	title: PlaylistVideoRendererTitle;
	index: DescriptionText;
	shortBylineText: OwnerText;
	lengthText: Text;
	navigationEndpoint: PlaylistVideoRendererNavigationEndpoint;
	lengthSeconds: string;
	trackingParams: string;
	isPlayable: boolean;
	menu: PlaylistVideoRendererMenu;
	thumbnailOverlays: PlaylistVideoRendererThumbnailOverlay[];
	videoInfo: DescriptionTapText;
}

interface Text {
	accessibility: ToggledAccessibilityDataClass;
	simpleText: string;
}

interface PlaylistVideoRendererMenu {
	menuRenderer: PurpleMenuRenderer;
}

interface PurpleMenuRenderer {
	items: PurpleItem[];
	trackingParams: string;
	accessibility: ToggledAccessibilityDataClass;
}

interface PurpleItem {
	menuServiceItemRenderer: MenuServiceItemRenderer;
}

interface MenuServiceItemRenderer {
	text: DescriptionTapText;
	icon: Icon;
	serviceEndpoint: MenuServiceItemRendererServiceEndpoint;
	trackingParams: string;
}

interface MenuServiceItemRendererServiceEndpoint {
	clickTrackingParams: string;
	commandMetadata: CommandCommandMetadata;
	signalServiceEndpoint: FluffySignalServiceEndpoint;
}

interface CommandCommandMetadata {
	webCommandMetadata: TentacledWebCommandMetadata;
}

interface TentacledWebCommandMetadata {
	sendPost: boolean;
}

interface FluffySignalServiceEndpoint {
	signal: Signal;
	actions: FluffyAction[];
}

interface FluffyAction {
	clickTrackingParams: string;
	addToPlaylistCommand: AddToPlaylistCommand;
}

interface AddToPlaylistCommand {
	openMiniplayer: boolean;
	videoId: string;
	listType: ListType;
	onCreateListCommand: OnCreateListCommand;
	videoIds: string[];
}

enum ListType {
	PlaylistEditListTypeQueue = 'PLAYLIST_EDIT_LIST_TYPE_QUEUE',
}

interface OnCreateListCommand {
	clickTrackingParams: string;
	commandMetadata: ContinuationEndpointCommandMetadata;
	createPlaylistServiceEndpoint: CreatePlaylistServiceEndpoint;
}

interface CreatePlaylistServiceEndpoint {
	videoIds: string[];
	params: CreatePlaylistServiceEndpointParams;
}

enum CreatePlaylistServiceEndpointParams {
	CAQ3D = 'CAQ%3D',
}

interface PlaylistVideoRendererNavigationEndpoint {
	clickTrackingParams: string;
	commandMetadata: OwnerEndpointCommandMetadata;
	watchEndpoint: FluffyWatchEndpoint;
}

interface FluffyWatchEndpoint {
	videoId: string;
	playlistId: TID;
	index?: number;
	params?: WatchEndpointParams;
	loggingContext: LoggingContext;
	watchEndpointSupportedOnesieConfig: WatchEndpointSupportedOnesieConfig;
}

enum WatchEndpointParams {
	CI9JIDW3D = 'CI9JIDw%3D',
	Oai3D = 'OAI%3D',
}

interface OwnerText {
	runs: OwnerTextRun[];
}

interface OwnerTextRun {
	text: string;
	navigationEndpoint: Endpoint;
}

interface Endpoint {
	clickTrackingParams: string;
	commandMetadata: OwnerEndpointCommandMetadata;
	browseEndpoint: OwnerEndpointBrowseEndpoint;
}

interface OwnerEndpointBrowseEndpoint {
	browseId: string;
	canonicalBaseUrl: string;
}

interface PlaylistVideoRendererThumbnail {
	thumbnails: ThumbnailElement[];
}

interface ThumbnailElement {
	url: string;
	width: number;
	height: number;
}

interface PlaylistVideoRendererThumbnailOverlay {
	thumbnailOverlayTimeStatusRenderer?: ThumbnailOverlayTimeStatusRenderer;
	thumbnailOverlayNowPlayingRenderer?: Renderer;
}

interface Renderer {
	text: DescriptionTapText;
}

interface ThumbnailOverlayTimeStatusRenderer {
	text: Text;
	style: StyleEnum;
}

enum StyleEnum {
	Default = 'DEFAULT',
}

interface PlaylistVideoRendererTitle {
	runs: DescriptionTapTextRun[];
	accessibility: ToggledAccessibilityDataClass;
}

function parseInitialData(data: string): Option<InitialData> {
	try {
		return JSON.parse(data.replace(/['"]/g, m => m === '"' ? '\'' : '"'));
	} catch {
		return;
	}
}

function parsePlaylist(data: InitialData): [Option<string>, SongData[]] {
	const playlist = data.contents?.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents[0].itemSectionRenderer.contents[0].playlistVideoListRenderer.contents;
	if (!playlist) return [undefined, []];

	const continuationToken = playlist.at(-1)?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
	if (continuationToken) playlist.pop();

	const videos = playlist.map(video => {
		const info = video.playlistVideoRenderer!;

		return {
			id: info.videoId,
			title: info.title.runs[0].text,
			url: `https://www.youtube.com/watch?v=${info.videoId}`,
			thumbnail: `https://i.ytimg.com/vi/${info.videoId}/hqdefault.jpg`,
			duration: parseInt(info.lengthSeconds) * 1_000,
			artist: info.shortBylineText.runs[0].text,
			live: false,
			type: SongProvider.YouTube,
		} satisfies SongData as SongData;
	});

	return [continuationToken, videos];
}

export const ID_REGEX = /^[\w-]{11}$/;

function videoInfoToSongData(data: videoInfo): SongData {
	const info = data.videoDetails;
	const related = data.related_videos.filter(v => v?.id);

	const song = {
		id: info.videoId,
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
		type: SongProvider.YouTube,
		format: info.isLiveContent
			? ytdl.chooseFormat(data.formats, {})
			: undefined,
		// only provide an array of related videos if there is at least one
		related: related.length > 0 ? related.map(v => v.id!) : undefined,
	};

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

async function getVideoIdFromQuery(query: string): Promise<Option<string>> {
	if (query === '?random') {
		const count = await Database.cache.countDocuments();
		if (count === 0) return;

		const [song] = await Database.cache
			.find({})
			.sort({ _id: 1 })
			.skip(randomInteger(count))
			.limit(1)
			.toArray();

		return song?.id ?? null;
	}

	const result = await axios.get<string>('https://www.youtube.com/results', {
		params: {
			search_query: query,
			sp: 'EgIQAQ==',
		},
	});

	if (result.status !== 200 && result.status !== 304) return;

	return result.data.match(/\/watch\?v=([\w-]{11})/)?.[1];
}

export async function handleYouTubeQuery(
	query: string,
	single = false
): Promise<Option<SearchResult>> {
	if (single) {
		const videoId = await getVideoIdFromQuery(query);
		if (videoId === undefined) return;

		return handleYouTubeVideo(videoId);
	}

	const names = query.split('\n');
	if (names.length === 1) return handleYouTubeQuery(query, true);

	return {
		videos: (
			await Promise.all(
				names.map(async title => {
					const result = await handleYouTubeQuery(title, true);
					if (result === undefined) return null;

					return result.videos[0];
				})
			)
		).filter(s => s !== null) as SongData[],
		title: undefined,
	};
}

export async function handleYouTubeVideo(id: string): Promise<SearchResult> {
	const cached = await getCachedSong(id);
	if (cached) {
		// Remove the unique id
		// @ts-expect-error - _id is not a property of SongData
		cached._id = undefined;

		return {
			videos: [cached],
			title: undefined,
		};
	}

	const data = videoInfoToSongData(
		await ytdl.getBasicInfo(`https://www.youtube.com/watch?v=${id}`, {
			requestOptions: {
				headers: {
					Cookie: process.env.COOKIE,
				},
			},
		})
	);

	await Database.addSongToCache(data);

	return {
		videos: [data],
		title: undefined,
	};
}

export async function handleYouTubePlaylist(id: string): Promise<Option<SearchResult>> {
	const { data: html } = await axios.get<string>(`https://www.youtube.com/playlist?list=${id}`);

	const dataString = html.match(INITIAL_DATA_REGEX)?.[1];
	if (!dataString) return;

	const data = parseInitialData(dataString);
	if (!data) return;

	const result = parsePlaylist(data);

	const videos = result[1];
	let continuationToken = result[0];

	while (continuationToken) {
		const { data } = await axios.post<InitialData>('https://www.youtube.com/youtubei/v1/browse', {
			'context': {
				'client': {
					'clientName': 'WEB',
					'clientVersion': '2.20221130.04.00',
				},
			},
			'continuation': '4qmFsgJfEiRWTFBMSV9lRlc4TkFGellBWFo1RHJVNkU2bVFfWGZoYUxCVVgaEkNBTjZCMUJVT2tOTE9FTSUzRJoCIlBMSV9lRlc4TkFGellBWFo1RHJVNkU2bVFfWGZoYUxCVVg%3D',
		}, {
			params: {
				key: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
			},
		});

		const [token, parsedVideos] = parsePlaylist(data);

		continuationToken = token;
		videos.push(...parsedVideos);
	}

	return {
		title: data.metadata?.playlistMetadataRenderer?.title,
		videos,
	};
}