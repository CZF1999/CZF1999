/**
 * 表格数据接口类型定义
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface TableResponse<T = any> {
  data: T[];
  total?: number;
  code?: number;
  message?: string;
}

/**
 * 查询参数类型
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type QueryParams = Record<string, any>;

/**
 * 模拟获取表格数据的 API
 * 实际项目中应该替换为真实的 HTTP 请求
 *
 * @param params - 查询参数
 * @returns 表格数据响应
 */
export function getTableData(params: QueryParams): Promise<TableResponse> {
  return new Promise((resolve, reject) => {
    // 模拟网络延迟
    const delay = 500 + Math.random() * 1500;

    setTimeout(() => {
      // 模拟 5% 的失败率
      if (Math.random() < 0.05) {
        reject(new Error('网络请求失败'));
        return;
      }

      // 生成模拟数据
      const mockData = Array.from({ length: 5 }, (_, i) => ({
        id: i + 1,
        name: `用户${i + 1}`,
        age: 20 + Math.floor(Math.random() * 30),
        address: `北京市朝阳区某某街道${i + 1}号`,
        ...params, // 包含查询参数以便区分
      }));

      resolve({
        data: mockData,
        total: 5,
        code: 200,
        message: 'success',
      });
    }, delay);
  });
}
