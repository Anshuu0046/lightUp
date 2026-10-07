// @ts-nocheck
import { d, tgpu } from 'typegpu'
import { parseDepthBundle } from './depth/inference/bundle.ts'
import { DepthInferencePlan } from './depth/inference/depthart.ts'
import { DepthRelightingRenderer } from './depth/DepthWebGpuRenderer'
import { snapAfterRender } from './capture'

const MODEL_URL='/models/depth.depthart'
export class DepthRuntime {
  private canvas:any; private root:any; private plan:any; private renderer:any; private ready=false
  async init(canvas:HTMLCanvasElement){
    this.canvas=canvas
    this.root=await tgpu.init({device:{optionalFeatures:['shader-f16']}})
    if(!this.root.device.features.has('shader-f16'))throw new Error('This browser does not support the depth lighting feature.')
    const response=await fetch(MODEL_URL);if(!response.ok)throw new Error('The lighting model is missing from this install.')
    const bundle=parseDepthBundle(await response.arrayBuffer());this.plan=new DepthInferencePlan(this.root,bundle);await this.plan.initAsync()
    this.renderer=new DepthRelightingRenderer(this.root,canvas);await this.renderer.initAsync();this.renderer.attach(this.plan);this.ready=true
  }
  /** Relights one video frame with full control over the light rig */
  draw(source:HTMLVideoElement, settings:Record<string,unknown>){
    if(!this.ready)return
    this.renderer.update(settings)
    const frame=new VideoFrame(source,{timestamp:performance.now()*1000});try{this.renderer.render({source:frame,uvTransform:d.mat2x2f.identity(),swapAxes:false})}finally{frame.close()}
    snapAfterRender(this.canvas)
  }
  destroy(){this.renderer?.destroy();this.plan?.destroy();this.root?.destroy()}
}

