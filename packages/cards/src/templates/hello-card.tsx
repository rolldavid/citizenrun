import type { JSX } from 'react';
import {
  Circle,
  ClipPath,
  Defs,
  fontAttrs,
  G,
  Image,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Svg,
  svgRootProps,
  Text,
} from '@citizenrun/cards/primitives';
import { assertNever } from '@citizenrun/shared';
import { HELLO_TEXT, HELLO_TREASURER } from '../__fixtures__/hello.fixtures.ts';
import type { HelloShape } from '../__fixtures__/hello.fixtures.ts';
import { CANVAS, PHOTO_BOX, round1 } from '../canvas.ts';
import { artRoles } from '../colors.ts';
import type { ArtRoles, CanvasColors } from '../colors.ts';

// CARD-hello (D-100, D-512): one canvas that draws each hard case once, so every target can be
// compared with the server's image. The gradient and the clip path are drawn here and on no card.

export type HelloCardProps = { colors: CanvasColors; photoHref: string; width?: number };

const VIEW_BOX = `0 0 ${String(CANVAS.width)} ${String(CANVAS.height)}`;
const PHOTO_FIT = 'xMidYMid slice';
const GRADIENT_ID = 'hello-gradient';
const CLIP_ID = 'hello-clip';

/** The two canvas switches, read as booleans so the card keeps both of their branches. */
const SWITCHES: { trackingEnabled: boolean; stickerTiltEnabled: boolean } = CANVAS;

/** The tracking of a line set at `size`, in units, or no attribute when tracked text is switched off. */
function tracking(size: number, em: number): { letterSpacing?: number } {
  return SWITCHES.trackingEnabled ? { letterSpacing: round1(size * em) } : {};
}

function drawShape(shape: HelloShape, roles: ArtRoles, key: number): JSX.Element {
  const fill = roles[shape.role];
  switch (shape.kind) {
    case 'rect':
      return (
        <Rect
          key={key}
          x={round1(shape.x)}
          y={round1(shape.y)}
          width={round1(shape.width)}
          height={round1(shape.height)}
          fill={fill}
        />
      );
    case 'circle':
      return (
        <Circle
          key={key}
          cx={round1(shape.cx)}
          cy={round1(shape.cy)}
          r={round1(shape.r)}
          fill={fill}
        />
      );
    case 'path':
      return <Path key={key} d={shape.d} fill={fill} />;
    default:
      return assertNever(shape);
  }
}

/** The hello card: the four faces, tracked and tilted text, a photo, a cut drawing, a gradient and a clip path. */
export function HelloCard(props: HelloCardProps): JSX.Element {
  const { colors, photoHref, width = CANVAS.width } = props;
  const roles = artRoles(colors, null, 'paper');
  const mono = CANVAS.type.mono;
  const title = CANVAS.type.title[0][0];
  const bigNumber = CANVAS.type.bigNumber.max;
  return (
    <Svg
      width={width}
      height={round1((width * CANVAS.height) / CANVAS.width)}
      viewBox={VIEW_BOX}
      {...svgRootProps()}
    >
      <Rect x={0} y={0} width={CANVAS.width} height={CANVAS.height} fill={colors.surface} />
      <Text
        x={66}
        y={110}
        {...fontAttrs('mono')}
        fontSize={mono}
        {...tracking(mono, CANVAS.track.caps)}
        fill={colors.textSecondary}
      >
        {HELLO_TEXT.monoLabel}
      </Text>
      <Text
        x={66}
        y={200}
        {...fontAttrs('medium')}
        fontSize={title}
        {...tracking(title, CANVAS.track.title)}
        fill={colors.text}
      >
        {HELLO_TEXT.title}
      </Text>
      <Image
        x={PHOTO_BOX.x}
        y={PHOTO_BOX.y}
        width={PHOTO_BOX.width}
        height={PHOTO_BOX.height}
        href={photoHref}
        preserveAspectRatio={PHOTO_FIT}
      />
      <Rect
        x={PHOTO_BOX.x}
        y={PHOTO_BOX.y}
        width={PHOTO_BOX.width}
        height={PHOTO_BOX.height}
        fill="none"
        stroke={colors.ruleSoft}
        strokeWidth={CANVAS.stroke.keyline}
      />
      <Text
        x={66}
        y={560}
        {...fontAttrs('bold')}
        fontSize={bigNumber}
        {...tracking(bigNumber, CANVAS.track.number)}
        fill={colors.text}
      >
        {HELLO_TEXT.bigNumber}
      </Text>
      <Text
        x={66}
        y={640}
        {...fontAttrs('regular')}
        fontSize={CANVAS.type.caption}
        fill={colors.textSecondary}
      >
        {HELLO_TEXT.caption}
      </Text>
      <G {...(SWITCHES.stickerTiltEnabled ? { transform: 'rotate(-3 236 726)' } : {})}>
        <Rect
          x={66}
          y={690}
          width={340}
          height={72}
          fill={colors.highlight}
          stroke={colors.onHighlight}
          strokeWidth={CANVAS.stroke.keyline}
        />
        <Text
          x={86}
          y={740}
          {...fontAttrs('mono')}
          fontSize={mono}
          {...tracking(mono, CANVAS.track.caps)}
          fill={colors.onHighlight}
        >
          {HELLO_TEXT.sticker}
        </Text>
      </G>
      <Text
        x={66}
        y={880}
        {...fontAttrs('medium')}
        fontSize={CANVAS.type.fact[0]}
        fill={colors.text}
      >
        {HELLO_TEXT.fact}
      </Text>
      <Text
        x={66}
        y={960}
        {...fontAttrs('regular')}
        fontSize={CANVAS.type.paragraph}
        fill={colors.text}
      >
        {HELLO_TEXT.paragraph[0]}
      </Text>
      <Text
        x={66}
        y={1016}
        {...fontAttrs('regular')}
        fontSize={CANVAS.type.paragraph}
        fill={colors.text}
      >
        {HELLO_TEXT.paragraph[1]}
      </Text>
      <Text
        x={66}
        y={1072}
        {...fontAttrs('regular')}
        fontSize={CANVAS.type.paragraph}
        fill={colors.text}
      >
        {HELLO_TEXT.paragraph[2]}
      </Text>
      <G transform="translate(630 790) scale(5.625)">
        {HELLO_TREASURER.shapes.map((shape, index) => drawShape(shape, roles, index))}
      </G>
      <Defs>
        <LinearGradient id={GRADIENT_ID} x1={0} y1={0} x2={1} y2={0}>
          <Stop offset={0} stopColor={colors.text} />
          <Stop offset={1} stopColor={colors.highlight} />
        </LinearGradient>
      </Defs>
      <Rect x={66} y={1130} width={200} height={60} fill={`url(#${GRADIENT_ID})`} />
      <Defs>
        <ClipPath id={CLIP_ID}>
          <Circle cx={360} cy={1185} r={60} fill={colors.text} />
        </ClipPath>
      </Defs>
      <G clipPath={`url(#${CLIP_ID})`}>
        <Image
          x={300}
          y={1110}
          width={120}
          height={150}
          href={photoHref}
          preserveAspectRatio={PHOTO_FIT}
        />
      </G>
    </Svg>
  );
}
