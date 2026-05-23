<template>
  <router-view />
</template>

<style scoped lang="less">
.app-container {
  padding: 20px;
  max-width: 1400px;
  margin: 0 auto;
}

h1 {
  color: #303133;
  margin-bottom: 10px;
}

.description {
  color: #606266;
  margin-bottom: 30px;
  font-size: 14px;
  line-height: 1.6;
}

.tables-container {
  display: flex;
  flex-direction: column;
  gap: 30px;
}

.table-wrapper {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);

  h3 {
    margin: 0 0 15px 0;
    color: #303133;
    font-size: 16px;
    font-weight: 600;
  }
}
</style>
