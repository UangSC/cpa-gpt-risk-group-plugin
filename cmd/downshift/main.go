package main

/*
#include <stdint.h>
#include <stdlib.h>
typedef struct { void* ptr; size_t len; } cliproxy_buffer;
typedef int (*host_call_fn)(void*, const char*, const uint8_t*, size_t, cliproxy_buffer*);
typedef void (*host_free_fn)(void*, size_t);
typedef struct { uint32_t abi_version; void* host_ctx; host_call_fn call; host_free_fn free_buffer; } cliproxy_host_api;
typedef int (*plugin_call_fn)(char*, uint8_t*, size_t, cliproxy_buffer*);
typedef void (*plugin_free_fn)(void*, size_t);
typedef void (*plugin_shutdown_fn)(void);
typedef struct { uint32_t abi_version; plugin_call_fn call; plugin_free_fn free_buffer; plugin_shutdown_fn shutdown; } cliproxy_plugin_api;
extern int cliproxyPluginCall(char*, uint8_t*, size_t, cliproxy_buffer*);
extern void cliproxyPluginFree(void*, size_t);
extern void cliproxyPluginShutdown(void);
static cliproxy_host_api stored_host;
static void store_host(cliproxy_host_api* host) { stored_host = *host; }
static int host_call(char* method, uint8_t* request, size_t len, cliproxy_buffer* response) {
    if (stored_host.call == NULL) return 1;
    return stored_host.call(stored_host.host_ctx, method, request, len, response);
}
static void host_free(void* ptr, size_t len) { if (ptr && stored_host.free_buffer != NULL) stored_host.free_buffer(ptr, len); }
*/
import "C"

import (
	"encoding/json"
	"errors"
	"unsafe"
)

var instance *plugin

func main() {}

//export cliproxy_plugin_init
func cliproxy_plugin_init(host *C.cliproxy_host_api, api *C.cliproxy_plugin_api) C.int {
	if host == nil || api == nil || host.abi_version != 1 || host.call == nil || host.free_buffer == nil {
		return 1
	}
	if instance != nil {
		instance.close()
	}
	C.store_host(host)
	instance = &plugin{host: callHost}
	api.abi_version = 1
	api.call = C.plugin_call_fn(C.cliproxyPluginCall)
	api.free_buffer = C.plugin_free_fn(C.cliproxyPluginFree)
	api.shutdown = C.plugin_shutdown_fn(C.cliproxyPluginShutdown)
	return 0
}

//export cliproxyPluginCall
func cliproxyPluginCall(method *C.char, request *C.uint8_t, length C.size_t, response *C.cliproxy_buffer) (code C.int) {
	if response == nil {
		return 1
	}
	response.ptr = nil
	response.len = 0
	defer func() {
		if recover() != nil {
			raw, _ := json.Marshal(envelope{Error: &rpcError{Code: "plugin_panic", Message: "插件内部操作失败", HTTPStatus: 500}})
			writeResponse(response, raw)
			code = 0
		}
	}()
	if instance == nil || method == nil || length > 32<<20 || (length > 0 && request == nil) {
		raw, _ := json.Marshal(envelope{Error: &rpcError{Code: "invalid_request", Message: "无效 ABI 请求", HTTPStatus: 400}})
		writeResponse(response, raw)
		return 0
	}
	result, err := instance.call(C.GoString(method), C.GoBytes(unsafe.Pointer(request), C.int(length)))
	out := envelope{OK: err == nil}
	if err != nil {
		var rpc *rpcError
		if errors.As(err, &rpc) {
			out.Error = rpc
		} else {
			out.Error = &rpcError{Code: "plugin_error", Message: "插件操作失败，请检查服务配置或状态文件", HTTPStatus: 500}
		}
	} else {
		out.Result, _ = json.Marshal(result)
	}
	raw, _ := json.Marshal(out)
	writeResponse(response, raw)
	return 0
}

func writeResponse(response *C.cliproxy_buffer, raw []byte) {
	response.ptr = C.CBytes(raw)
	response.len = C.size_t(len(raw))
}

//export cliproxyPluginFree
func cliproxyPluginFree(ptr unsafe.Pointer, length C.size_t) {
	if ptr != nil {
		C.free(ptr)
	}
}

//export cliproxyPluginShutdown
func cliproxyPluginShutdown() {
	if instance != nil {
		instance.close()
	}
}

func callHost(method string, request any, result any) error {
	raw, err := json.Marshal(request)
	if err != nil {
		return err
	}
	name := C.CString(method)
	defer C.free(unsafe.Pointer(name))
	payload := C.CBytes(raw)
	defer C.free(payload)
	var response C.cliproxy_buffer
	code := C.host_call(name, (*C.uint8_t)(payload), C.size_t(len(raw)), &response)
	if response.ptr != nil {
		defer C.host_free(response.ptr, response.len)
	}
	if response.ptr == nil || response.len > 16<<20 {
		if code != 0 {
			return errors.New("CPA 宿主回调返回错误码")
		}
		return errors.New("CPA 宿主返回无效缓冲区")
	}
	var out envelope
	if json.Unmarshal(C.GoBytes(response.ptr, C.int(response.len)), &out) != nil {
		return errors.New("CPA 宿主返回无效 JSON")
	}
	if !out.OK {
		if out.Error != nil {
			return out.Error
		}
		return errors.New("CPA 宿主回调失败")
	}
	if code != 0 {
		return errors.New("CPA 宿主回调返回错误码")
	}
	if result != nil {
		return json.Unmarshal(out.Result, result)
	}
	return nil
}
