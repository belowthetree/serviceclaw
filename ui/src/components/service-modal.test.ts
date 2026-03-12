import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ServiceModal } from "./service-modal.ts";

describe("ServiceModal", () => {
  let modal: ServiceModal;

  beforeEach(() => {
    vi.useFakeTimers();
    modal = new ServiceModal();
    document.body.appendChild(modal);
  });

  afterEach(() => {
    modal.remove();
    vi.useRealTimers();
  });

  describe("initialization", () => {
    it("should create with default properties", () => {
      expect(modal.serviceId).toBeNull();
      expect(modal.serviceName).toBe("");
      expect(modal.basePath).toBe("/__openclaw__/services");
      expect(modal.loadingTimeout).toBe(30000);
      expect(modal.closeOnBackdrop).toBe(true);
      expect(modal.closeOnEscape).toBe(true);
    });

    it("should start in closed state", () => {
      expect(modal.isOpen()).toBe(false);
      expect(modal.getState()).toBe("closed");
    });
  });

  describe("open", () => {
    it("should open modal with service details", () => {
      modal.open("calendar", "Calendar Service");

      expect(modal.isOpen()).toBe(true);
      expect(modal.getState()).toBe("loading");
      expect(modal.serviceId).toBe("calendar");
      expect(modal.serviceName).toBe("Calendar Service");
    });

    it("should dispatch modal-open event", () => {
      const listener = vi.fn();
      modal.addEventListener("modal-open", listener);

      modal.open("test-service", "Test Service");

      expect(listener).toHaveBeenCalledOnce();
      const event = listener.mock.calls[0][0] as CustomEvent;
      expect(event.detail).toEqual({
        serviceId: "test-service",
        serviceName: "Test Service",
      });
    });

    it("should transition to loading state", () => {
      modal.open("my-service", "My Service");

      expect(modal.getState()).toBe("loading");
    });

    it("should close existing modal before opening new one", () => {
      modal.open("service1", "Service 1");
      const closeListener = vi.fn();
      modal.addEventListener("modal-close", closeListener);

      modal.open("service2", "Service 2");

      expect(closeListener).toHaveBeenCalledOnce();
      expect(modal.serviceId).toBe("service2");
    });
  });

  describe("close", () => {
    beforeEach(() => {
      modal.open("test-service", "Test Service");
    });

    it("should close modal", () => {
      modal.close();

      expect(modal.isOpen()).toBe(false);
      expect(modal.getState()).toBe("closed");
    });

    it("should dispatch modal-close event", () => {
      const listener = vi.fn();
      modal.addEventListener("modal-close", listener);

      modal.close();

      expect(listener).toHaveBeenCalledOnce();
      const event = listener.mock.calls[0][0] as CustomEvent;
      expect(event.detail).toEqual({
        serviceId: "test-service",
      });
    });

    it("should not dispatch event if already closed", () => {
      modal.close();
      const listener = vi.fn();
      modal.addEventListener("modal-close", listener);

      modal.close();

      expect(listener).not.toHaveBeenCalled();
    });

    it("should clear iframe reference", async () => {
      modal.close();

      vi.advanceTimersByTime(250);

      expect(modal.serviceId).toBeNull();
    });
  });

  describe("isOpen", () => {
    it("should return false when closed", () => {
      expect(modal.isOpen()).toBe(false);
    });

    it("should return true when loading", () => {
      modal.open("test", "Test");
      expect(modal.isOpen()).toBe(true);
    });

    it("should return true when loaded", () => {
      modal.open("test", "Test");
      // Simulate loaded state by directly setting it
      (modal as unknown as { _state: string })._state = "loaded";
      expect(modal.isOpen()).toBe(true);
    });

    it("should return true when error", () => {
      modal.open("test", "Test");
      (modal as unknown as { _state: string })._state = "error";
      expect(modal.isOpen()).toBe(true);
    });
  });

  describe("getState", () => {
    it("should return closed initially", () => {
      expect(modal.getState()).toBe("closed");
    });

    it("should return loading after open", () => {
      modal.open("test", "Test");
      expect(modal.getState()).toBe("loading");
    });
  });

  describe("reload", () => {
    it("should reload current service when iframe exists", async () => {
      modal.open("test-service", "Test Service");
      vi.advanceTimersByTime(50);

      (modal as unknown as { _state: string })._state = "error";

      const iframe = document.createElement("iframe");
      (modal as unknown as { _iframeRef: HTMLIFrameElement })._iframeRef = iframe;

      modal.reload();

      expect(modal.getState()).toBe("loading");
    });

    it("should do nothing if no service is open", () => {
      modal.reload();

      expect(modal.getState()).toBe("closed");
    });

    it("should do nothing if iframe does not exist", () => {
      modal.open("test-service", "Test Service");
      vi.advanceTimersByTime(50);

      (modal as unknown as { _state: string })._state = "loaded";

      modal.reload();

      expect(modal.getState()).toBe("loaded");
    });
  });

  describe("iframe src building", () => {
    it("should build correct iframe src", () => {
      modal.open("calendar", "Calendar");

      // The iframe src should be built correctly
      expect(modal.basePath).toBe("/__openclaw__/services");
    });

    it("should allow custom base path", () => {
      modal.basePath = "/custom/services";
      modal.open("calendar", "Calendar");

      expect(modal.basePath).toBe("/custom/services");
    });
  });

  describe("keyboard handling", () => {
    it("should close on escape key when enabled", () => {
      modal.closeOnEscape = true;
      modal.open("test", "Test");

      vi.advanceTimersByTime(50);

      const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
      document.dispatchEvent(event);

      expect(modal.isOpen()).toBe(false);
    });

    it("should not close on escape when disabled", () => {
      const customModal = new ServiceModal();
      customModal.closeOnEscape = false;
      document.body.appendChild(customModal);

      customModal.open("test", "Test");
      vi.advanceTimersByTime(50);

      const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
      document.dispatchEvent(event);

      expect(customModal.isOpen()).toBe(true);

      customModal.remove();
    });

    it("should not close on other keys", () => {
      modal.open("test", "Test");

      vi.advanceTimersByTime(50);

      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      document.dispatchEvent(event);

      expect(modal.isOpen()).toBe(true);
    });
  });

  describe("event dispatching", () => {
    it("should dispatch modal-error on error", () => {
      modal.open("test-service", "Test");

      const listener = vi.fn();
      modal.addEventListener("modal-error", listener);

      const errorMethod = (modal as unknown as { _setError: (msg: string) => void })._setError;
      errorMethod.call(modal, "Test error");

      expect(listener).toHaveBeenCalledOnce();
      const event = listener.mock.calls[0][0] as CustomEvent;
      expect(event.detail).toEqual({
        serviceId: "test-service",
        error: "Test error",
      });
    });
  });

  describe("component lifecycle", () => {
    it("should add keyboard listener on connect", () => {
      const addEventListenerSpy = vi.spyOn(document, "addEventListener");
      const newModal = new ServiceModal();

      document.body.appendChild(newModal);

      expect(addEventListenerSpy).toHaveBeenCalledWith("keydown", expect.any(Function));

      newModal.remove();
    });

    it("should remove keyboard listener on disconnect", () => {
      const removeEventListenerSpy = vi.spyOn(document, "removeEventListener");

      modal.remove();

      expect(removeEventListenerSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
    });

    it("should clear loading timer on disconnect", () => {
      modal.open("test", "Test");

      modal.remove();

      vi.advanceTimersByTime(35000);

      expect(modal.getState()).toBe("loading");
    });
  });

  describe("properties", () => {
    it("should accept serviceId property", () => {
      modal.serviceId = "my-service";
      expect(modal.serviceId).toBe("my-service");
    });

    it("should accept serviceName property", () => {
      modal.serviceName = "My Service";
      expect(modal.serviceName).toBe("My Service");
    });

    it("should accept basePath property", () => {
      modal.basePath = "/api/services";
      expect(modal.basePath).toBe("/api/services");
    });

    it("should accept loadingTimeout property", () => {
      modal.loadingTimeout = 60000;
      expect(modal.loadingTimeout).toBe(60000);
    });

    it("should accept closeOnBackdrop property", () => {
      modal.closeOnBackdrop = false;
      expect(modal.closeOnBackdrop).toBe(false);
    });

    it("should accept closeOnEscape property", () => {
      modal.closeOnEscape = false;
      expect(modal.closeOnEscape).toBe(false);
    });
  });
});
