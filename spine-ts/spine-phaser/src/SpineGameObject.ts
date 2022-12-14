import { SPINE_GAME_OBJECT_TYPE } from "./keys";
import { SpinePlugin } from "./SpinePlugin";
import { ComputedSizeMixin, DepthMixin, FlipMixin, ScrollFactorMixin, TransformMixin, VisibleMixin } from "./mixins";
import { AnimationState, AnimationStateData, MathUtils, Skeleton } from "@esotericsoftware/spine-core";

class BaseSpineGameObject extends Phaser.GameObjects.GameObject {
	constructor(scene: Phaser.Scene, type: string) {
		super(scene, type);
	}
}

export interface SpineGameObjectBoundsProvider {
	calculateBounds(gameObject: SpineGameObject): { x: number, y: number, width: number, height: number };
}

export class SetupPoseBoundsProvider implements SpineGameObjectBoundsProvider {
	calculateBounds(gameObject: SpineGameObject) {
		if (!gameObject.skeleton) return { x: 0, y: 0, width: 0, height: 0 };
		gameObject.skeleton.setToSetupPose();
		gameObject.skeleton.updateWorldTransform();
		return gameObject.skeleton.getBoundsRect();
	}
}

export class SkinsAndAnimationBoundsProvider implements SpineGameObjectBoundsProvider {
	constructor(private animation: string, private skins: string[] = []) {

	}

	calculateBounds(gameObject: SpineGameObject): { x: number; y: number; width: number; height: number; } {
		if (!gameObject.skeleton) return { x: 0, y: 0, width: 0, height: 0 };
		// FIXME
		gameObject.skeleton.setToSetupPose();
		gameObject.skeleton.updateWorldTransform();
		return gameObject.skeleton.getBoundsRect();
	}
}

export class SpineGameObject extends ComputedSizeMixin(DepthMixin(FlipMixin(ScrollFactorMixin(TransformMixin(VisibleMixin(BaseSpineGameObject)))))) {
	blendMode = -1;
	skeleton: Skeleton | null = null;
	animationStateData: AnimationStateData | null = null;
	animationState: AnimationState | null = null;
	private premultipliedAlpha = false;
	private _displayOriginX = 0;
	private _displayOriginY = 0;
	private _scaleX = 1;
	private _scaleY = 1;

	constructor(scene: Phaser.Scene, private plugin: SpinePlugin, x: number, y: number, dataKey: string, atlasKey: string, public boundsProvider: SpineGameObjectBoundsProvider = new SetupPoseBoundsProvider()) {
		super(scene, SPINE_GAME_OBJECT_TYPE);
		this.setPosition(x, y); x
		this.setSkeleton(dataKey, atlasKey);
	}

	setSkeleton(dataKey: string, atlasKey: string) {
		if (dataKey && atlasKey) {
			this.premultipliedAlpha = this.plugin.isAtlasPremultiplied(atlasKey);
			this.skeleton = this.plugin.createSkeleton(dataKey, atlasKey);
			this.animationStateData = new AnimationStateData(this.skeleton.data);
			this.animationState = new AnimationState(this.animationStateData);
			this.updateSize();
		} else {
			this.skeleton = null;
			this.animationStateData = null;
			this.animationState = null;
		}
	}

	public get displayOriginX() {
		return this._displayOriginX;
	}

	public set displayOriginX(value: number) {
		this._displayOriginX = value;
	}

	public get displayOriginY() {
		return this._displayOriginY;
	}

	public set displayOriginY(value: number) {
		this._displayOriginY = value;
	}

	public get scaleX() {
		return this._scaleX;
	}

	public set scaleX(value: number) {
		this._scaleX = value;
		this.updateSize();
	}

	public get scaleY() {
		return this._scaleX;
	}

	public set scaleY(value: number) {
		this._scaleY = value;
		this.updateSize();
	}

	updateSize() {
		if (!this.skeleton) return;
		let bounds = this.boundsProvider.calculateBounds(this);
		// For some reason the TS compiler and the ComputedSize mixin don't work well together...
		let self = this as any;
		self.width = bounds.width;
		self.height = bounds.height;
		this.displayOriginX = -bounds.x;
		this.displayOriginY = -bounds.y;
	}

	preUpdate(time: number, delta: number) {
		if (!this.skeleton || !this.animationState) return;

		this.animationState.update(delta / 1000);
		this.animationState.apply(this.skeleton);
		this.skeleton.updateWorldTransform();
	}

	preDestroy() {
		this.skeleton = null;
		this.animationState = null;
		// FIXME tear down any event emitters
	}

	willRender(camera: Phaser.Cameras.Scene2D.Camera) {
		if (!this.visible) return false;

		var GameObjectRenderMask = 0xf;
		var result = (!this.skeleton || !(GameObjectRenderMask !== this.renderFlags || (this.cameraFilter !== 0 && (this.cameraFilter & camera.id))));

		return result;
	}

	renderWebGL(renderer: Phaser.Renderer.WebGL.WebGLRenderer, src: SpineGameObject, camera: Phaser.Cameras.Scene2D.Camera, parentMatrix: Phaser.GameObjects.Components.TransformMatrix) {
		if (!this.skeleton || !this.animationState || !this.plugin.webGLRenderer) return;

		let sceneRenderer = this.plugin.webGLRenderer;
		if (renderer.newType) {
			renderer.pipelines.clear();
			sceneRenderer.begin();
		}

		camera.addToRenderList(src);
		let transform = Phaser.GameObjects.GetCalcMatrix(src, camera, parentMatrix).calc;
		let a = transform.a, b = transform.b, c = transform.c, d = transform.d, tx = transform.tx, ty = transform.ty;
		sceneRenderer.drawSkeleton(this.skeleton, this.premultipliedAlpha, -1, -1, (vertices, numVertices, stride) => {
			for (let i = 0; i < numVertices; i += stride) {
				let vx = vertices[i];
				let vy = vertices[i + 1];
				vertices[i] = vx * a + vy * c + tx;
				vertices[i + 1] = vx * b + vy * d + ty;
			}
		});

		if (!renderer.nextTypeMatch) {
			sceneRenderer.end();
			renderer.pipelines.rebind();
		}
	}

	renderCanvas(renderer: Phaser.Renderer.Canvas.CanvasRenderer, src: SpineGameObject, camera: Phaser.Cameras.Scene2D.Camera, parentMatrix: Phaser.GameObjects.Components.TransformMatrix) {
		if (!this.skeleton || !this.animationState || !this.plugin.canvasRenderer) return;

		let context = renderer.currentContext;
		let skeletonRenderer = this.plugin.canvasRenderer;
		(skeletonRenderer as any).ctx = context;

		camera.addToRenderList(src);
		let transform = Phaser.GameObjects.GetCalcMatrix(src, camera, parentMatrix).calc;
		let skeleton = this.skeleton;
		skeleton.x = transform.tx;
		skeleton.y = transform.ty;
		skeleton.scaleX = transform.scaleX;
		skeleton.scaleY = transform.scaleY;
		let root = skeleton.getRootBone()!;
		root.rotation = -MathUtils.radiansToDegrees * transform.rotationNormalized;
		this.skeleton.updateWorldTransform();

		context.save();
		skeletonRenderer.draw(skeleton);
		context.restore();
	}
}