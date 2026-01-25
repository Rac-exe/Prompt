import { screen } from "electron";

/**
 * Snap position identifiers
 */
export enum SnapPosition {
  TOP_LEFT = "top-left",
  TOP_CENTER = "top-center",
  TOP_RIGHT = "top-right",
  MIDDLE_LEFT = "middle-left",
  MIDDLE_RIGHT = "middle-right",
  BOTTOM_LEFT = "bottom-left",
  BOTTOM_CENTER = "bottom-center",
  BOTTOM_RIGHT = "bottom-right"
}

/**
 * Screen coordinates
 */
export interface ScreenCoordinates {
  x: number;
  y: number;
}

/**
 * Snap position calculator - calculates overlay positions based on screen size
 */
export class SnapPositionCalculator {
  private readonly MARGIN = 20; // Distance from screen edge
  private readonly OVERLAY_WIDTH = 64; // Circular orb size (v3 design)
  private readonly OVERLAY_HEIGHT = 64;

  /**
   * Get all available snap positions for current screen
   */
  getAllPositions(): Map<SnapPosition, ScreenCoordinates> {
    const display = screen.getPrimaryDisplay();
    const { width, height } = display.workAreaSize;

    const positions = new Map<SnapPosition, ScreenCoordinates>();

    // Top row
    positions.set(SnapPosition.TOP_LEFT, {
      x: this.MARGIN,
      y: this.MARGIN
    });

    positions.set(SnapPosition.TOP_CENTER, {
      x: Math.floor((width - this.OVERLAY_WIDTH) / 2),
      y: this.MARGIN
    });

    positions.set(SnapPosition.TOP_RIGHT, {
      x: width - this.OVERLAY_WIDTH - this.MARGIN,
      y: this.MARGIN
    });

    // Middle row
    positions.set(SnapPosition.MIDDLE_LEFT, {
      x: this.MARGIN,
      y: Math.floor((height - this.OVERLAY_HEIGHT) / 2)
    });

    positions.set(SnapPosition.MIDDLE_RIGHT, {
      x: width - this.OVERLAY_WIDTH - this.MARGIN,
      y: Math.floor((height - this.OVERLAY_HEIGHT) / 2)
    });

    // Bottom row
    positions.set(SnapPosition.BOTTOM_LEFT, {
      x: this.MARGIN,
      y: height - this.OVERLAY_HEIGHT - this.MARGIN
    });

    positions.set(SnapPosition.BOTTOM_CENTER, {
      x: Math.floor((width - this.OVERLAY_WIDTH) / 2),
      y: height - this.OVERLAY_HEIGHT - this.MARGIN
    });

    positions.set(SnapPosition.BOTTOM_RIGHT, {
      x: width - this.OVERLAY_WIDTH - this.MARGIN,
      y: height - this.OVERLAY_HEIGHT - this.MARGIN
    });

    return positions;
  }

  /**
   * Find nearest snap position to given coordinates
   */
  findNearestPosition(x: number, y: number): SnapPosition {
    const positions = this.getAllPositions();
    let nearestPosition = SnapPosition.TOP_RIGHT;
    let minDistance = Infinity;

    positions.forEach((coords, position) => {
      const distance = Math.sqrt(
        Math.pow(coords.x - x, 2) + Math.pow(coords.y - y, 2)
      );

      if (distance < minDistance) {
        minDistance = distance;
        nearestPosition = position;
      }
    });

    return nearestPosition;
  }

  /**
   * Get coordinates for a specific snap position
   */
  getPosition(position: SnapPosition): ScreenCoordinates {
    const positions = this.getAllPositions();
    return positions.get(position) || { x: this.MARGIN, y: this.MARGIN };
  }

  /**
   * Get overlay dimensions
   */
  getDimensions() {
    return {
      width: this.OVERLAY_WIDTH,
      height: this.OVERLAY_HEIGHT
    };
  }
}
