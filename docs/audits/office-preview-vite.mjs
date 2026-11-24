import {defineConfig,mergeConfig} from 'vite';
import config from '/app/vite.config.ts';
export default defineConfig(env=>mergeConfig(config(env),{server:{host:'0.0.0.0',port:4189,proxy:{'/api':{target:'http://oxeio-office-preview-api:3000',changeOrigin:false,secure:true}}}}));
