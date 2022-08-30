export interface GutenbergResponse<T> {
	results: T[];
}

export interface GutenbergBook {
	id: number;
	title: string;
	authors: { name: string }[];
	formats: Record<string, string>;
}
