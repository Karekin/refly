// 导入 Express 的 Request 类型
import { Request } from 'express';
// 导入 WebSocket 客户端类
import { WebSocket } from 'ws';
// 导入 NestJS WebSocket 网关相关装饰器和接口
import { OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';
// 导入协作服务
import { CollabService } from '@/collab/collab.service';

// 使用 WebSocketGateway 装饰器声明这是一个 WebSocket 网关
@WebSocketGateway()
// 实现 OnGatewayConnection 接口，处理连接事件
export class CollabGateway implements OnGatewayConnection {
  // 构造函数，注入协作服务
  constructor(private collabService: CollabService) {}

  // 实现连接处理方法
  handleConnection(connection: WebSocket, request: Request): void {
    // 将连接和请求交给协作服务处理
    this.collabService.handleConnection(connection, request);
  }
}
