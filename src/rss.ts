import * as xml from "fast-xml-parser";
import * as he from "he";

export interface Enclosure {
  remoteUrl: string;
  localUrl: string;
  localPath: string;
  type: string;
  length?: string;
}

export interface Item {
  title: string;
  link: string;
  description: string;
  enclosure: Enclosure;
  guid: string;
  guidHash: string;
  pubDate: number;
  pubDateAsString: string;
}

export interface Image {
  localPath: string;
  localUrl: string;
  remoteUrl: string;
}

export interface Channel {
  description: string;
  image?: Image;
  items: Item[];
  language: string;
  lastBuildDate: number;
  link: string;
  pubDate: number;
  title: string;
  owner?: {
    name: string;
    email: string;
  };
  author?: string;
  copyright?: string;
}

export function toXml(channel: Channel): string {
  const xmlOptions = {
    attrValueProcessor: (a: string) => he.encode(a, {useNamedReferences: true}),
    cdataTagName: "__cdata",
    format: true,
    ignoreAttributes: false,
    tagValueProcessor: (a: string) => he.encode(a, {useNamedReferences: true}),
  };
  const parser = new xml.j2xParser(xmlOptions);
  const feed = {
    rss: {
      "@_version": "2.0",
      "@_xmlns:atom": "http://www.w3.org/2005/Atom",
      "@_xmlns:content": "http://purl.org/rss/1.0/modules/content/",
      "@_xmlns:googleplay": "http://www.google.com/schemas/play-podcasts/1.0",
      "@_xmlns:itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd",
      "channel": {
        "description": {
          __cdata: channel.description,
        },
        "generator": "podstash",
        "googleplay:block": "yes",
        "item": channel.items.map((item) => ({
          description: {
            __cdata: item.description,
          },
          enclosure: {
            "@_length": item.enclosure.length,
            "@_type": item.enclosure.type,
            "@_url": item.enclosure.localUrl,
          },
          guid: {
            "#text": item.guid,
            "@_isPermaLink": "false",
          },
          link: item.link,
          pubDate: new Date(item.pubDate || 0).toUTCString(),
          title: {__cdata: item.title},
        })),
        "itunes:block": "Yes",
        "language": {__cdata: channel.language},
        "lastBuildDate": new Date(Date.now()).toUTCString(),
        "link": channel.link,
        "title": {__cdata: channel.title},
      },
    },
  };
  const addToChannel = (extra: any) => {
    feed.rss.channel = {
      ...feed.rss.channel,
      ...extra,
    };
  };
  if (channel.image) {
    addToChannel({
      "image": {
        link: channel.link,
        title: channel.title,
        url: channel.image.localUrl,
      },
      "itunes:image": {
        "@_href": channel.image.localUrl,
      },
    });
  }
  if (channel.owner) {
    addToChannel({
      "itunes:owner": {
        "itunes:email": channel.owner.email,
        "itunes:name": channel.owner.name,
      },
    });
  }
  if (channel.author) {
    addToChannel({
      "itunes:author": channel.author,
    });
  }
  if (channel.copyright) {
    addToChannel({
      copyright: channel.copyright,
    });
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + parser.parse(feed);
}

export function fromXml(content: string): any {
  const xmlOptions = {
    attrValueProcessor: (a: string) => he.decode(a, {isAttributeValue: true}),
    ignoreAttributes: false,
    tagValueProcessor: (a: string) => he.decode(a),
  };
  return xml.parse(content.toString(), xmlOptions);
}
