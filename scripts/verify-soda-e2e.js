'use strict';

/**
 * 汽水音乐端到端链路验证
 * 
 * 验证项:
 * - 搜索 API
 * - 播放地址解析
 * - 音频流代理
 * 
 * 安全: 不输出 cookie/token/signature/完整 URL
 */

const http = require('http');

const BASE_URL = process.env.MINERADIO_BASE_URL || 'http://localhost:3000';
const TEST_KEYWORDS = process.env.MINERADIO_TEST_KEYWORDS || '晴天';

let passed = 0;
let failed = 0;

function log(status, message) {
  const icon = status === 'PASS' ? '✅' : '❌';
  console.log(`${icon} [${status}] ${message}`);
  if (status === 'PASS') passed++;
  else failed++;
}

function request(path) {
  return new Promise((resolve, reject) => {
    const url = `${BASE_URL}${path}`;
    http.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          reject(new Error(`JSON parse failed: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

async function testSearch() {
  try {
    const { status, data } = await request(`/api/soda/search?keywords=${encodeURIComponent(TEST_KEYWORDS)}&limit=3`);
    
    if (status !== 200) {
      log('FAIL', `Search returned status ${status}`);
      return null;
    }
    
    if (!data.songs || !Array.isArray(data.songs)) {
      log('FAIL', 'Search returned invalid songs array');
      return null;
    }
    
    if (data.songs.length === 0) {
      log('FAIL', 'Search returned no songs');
      return null;
    }
    
    const song = data.songs[0];
    if (!song.sodaId && !song.id) {
      log('FAIL', 'Search result missing sodaId/id');
      return null;
    }
    
    log('PASS', `Search returned ${data.songs.length} songs`);
    return song;
  } catch (e) {
    log('FAIL', `Search error: ${e.message}`);
    return null;
  }
}

async function testSongUrl(songId) {
  try {
    const { status, data } = await request(`/api/soda/song/url?id=${songId}`);
    
    if (status !== 200) {
      log('FAIL', `Song URL returned status ${status}`);
      return null;
    }
    
    if (data.provider !== 'soda') {
      log('FAIL', `Song URL returned provider: ${data.provider}`);
      return null;
    }
    
    if (!data.url) {
      log('FAIL', 'Song URL returned no url');
      return null;
    }
    
    if (!data.playable) {
      log('FAIL', `Song URL returned playable: false, error: ${data.error || 'none'}`);
      return null;
    }
    
    log('PASS', `Song URL resolved: playable=${data.playable}, level=${data.level || 'unknown'}`);
    return data;
  } catch (e) {
    log('FAIL', `Song URL error: ${e.message}`);
    return null;
  }
}

async function testAudioProxy(audioUrl) {
  try {
    const url = new URL(audioUrl, BASE_URL);
    const path = url.pathname + url.search;
    
    const result = await new Promise((resolve, reject) => {
      http.get(`${BASE_URL}${path}`, { timeout: 5000 }, (res) => {
        let size = 0;
        res.on('data', chunk => size += chunk.length);
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            contentType: res.headers['content-type'],
            size
          });
        });
      }).on('error', reject);
    });
    
    if (result.status !== 200) {
      log('FAIL', `Audio proxy returned status ${result.status}`);
      return false;
    }
    
    if (!result.contentType || !result.contentType.includes('audio')) {
      log('FAIL', `Audio proxy returned content-type: ${result.contentType}`);
      return false;
    }
    
    if (result.size < 1024) {
      log('FAIL', `Audio proxy returned too small: ${result.size} bytes`);
      return false;
    }
    
    log('PASS', `Audio proxy: ${result.contentType}, ${result.size} bytes`);
    return true;
  } catch (e) {
    log('FAIL', `Audio proxy error: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log('=== 汽水音乐端到端链路验证 ===\n');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Test Keywords: ${TEST_KEYWORDS}\n`);
  
  // Test 1: Search
  console.log('--- Test 1: Search API ---');
  const song = await testSearch();
  if (!song) {
    console.log('\n❌ 验证失败: 搜索无结果');
    process.exit(1);
  }
  
  // Test 2: Song URL
  console.log('\n--- Test 2: Song URL ---');
  const songId = song.sodaId || song.id;
  const songData = await testSongUrl(songId);
  if (!songData) {
    console.log('\n❌ 验证失败: 播放地址解析失败');
    process.exit(1);
  }
  
  // Test 3: Audio Proxy
  console.log('\n--- Test 3: Audio Proxy ---');
  const audioUrl = songData.url;
  if (audioUrl.startsWith('/api/')) {
    const proxyOk = await testAudioProxy(audioUrl);
    if (!proxyOk) {
      console.log('\n❌ 验证失败: 音频流代理失败');
      process.exit(1);
    }
  } else {
    log('PASS', 'Audio URL is direct (not proxied)');
  }
  
  // Summary
  console.log('\n=== 验证结果 ===');
  console.log(`✅ 通过: ${passed}`);
  console.log(`❌ 失败: ${failed}`);
  
  if (failed > 0) {
    console.log('\n❌ 验证失败');
    process.exit(1);
  } else {
    console.log('\n✅ 验证通过');
    process.exit(0);
  }
}

main().catch(e => {
  console.error('验证脚本异常:', e.message);
  process.exit(1);
});
